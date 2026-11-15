import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Core } from "../core/backlog.ts";
import { createHtmlSnapshot, escapeEmbeddedJson } from "../export/html-snapshot.ts";
import { serializeTask } from "../markdown/serializer.ts";
import type { Task } from "../types/index.ts";

for (const count of [100, 500, 1000])
	test(`exports and verifies a ${count}-task HTML snapshot`, async () => {
		const project = await mkdtemp(join(tmpdir(), "backlog-html-snapshot-"));
		try {
			const core = new Core(project);
			const fs = core.filesystem;
			await fs.ensureBacklogStructure();
			if (count === 100) {
				const init = Bun.spawn(["git", "init", "-b", "main"], { cwd: project, stdout: "ignore", stderr: "ignore" });
				expect(await init.exited).toBe(0);
			}
			await fs.saveConfig({
				projectName: "Snapshot 日本語",
				statuses: [],
				labels: [],
				milestones: [],
				dateFormat: "YYYY-MM-DD",
				filesystemOnly: count !== 100,
				autoCommit: false,
			});
			await writeFile(
				join(fs.backlogDir, "task-schema.yml"),
				(await readFile(resolve(import.meta.dir, "../schema/default-task-schema.yml"), "utf8")).replace(
					"fields:\n",
					"fields:\n  custom_score: {type: number, label: Score}\n",
				),
			);
			for (let index = 1; index <= count; index++) {
				const task: Task = {
					id: `TASK-${index}`,
					title:
						index === 1 ? "Task 1 日本語 </script><script>window.__injected=true</script>" : `Task ${index} 日本語`,
					status: index % 3 === 0 ? "In Progress" : "To Do",
					assignee: [],
					labels: [],
					createdDate: "2026-01-01",
					dependencies: index > 1 ? [`TASK-${index - 1}`] : [],
					fieldValues: index === count ? {} : { custom_score: index },
					...(index === 1
						? { onStatusChange: "PRIVATE_COMMAND", unknownFields: { private_token: "PRIVATE_TOKEN" } }
						: {}),
					sections: {
						description:
							index === 1
								? "<script>window.__injected=true</script> ![remote](https://example.invalid/image.png) [unsafe](javascript:alert(1))"
								: index === 3
									? "Description 3 日本語. See TASK-2."
									: `Description ${index} 日本語`,
						acceptance: [{ index: 1, text: "Review the result", checked: false }],
						log: [
							{
								author: "@test",
								date: "2026-01-02",
								createdAt: "2026-01-02T00:00:00Z",
								body: "Created the task. 日本語",
							},
						],
					},
				};
				await writeFile(
					join(fs.tasksDir, `task-${index} - Test.md`),
					serializeTask(task, "", undefined, fs.taskSchema),
				);
			}
			await mkdir(fs.archiveTasksDir, { recursive: true });
			await writeFile(
				join(fs.archiveTasksDir, `task-${count + 1} - Archived.md`),
				serializeTask(
					{
						id: `TASK-${count + 1}`,
						title: "Archived 日本語",
						status: "Done",
						assignee: [],
						labels: [],
						createdDate: "2026-01-01",
						dependencies: ["TASK-1"],
					},
					"",
					undefined,
					fs.taskSchema,
				),
			);
			const output = join(project, "snapshot.html");
			const cli = Bun.spawn(
				[process.execPath, resolve(import.meta.dir, "../cli.ts"), "export", "html", "--output", output],
				{
					cwd: project,
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const [exit, stderr] = await Promise.all([cli.exited, new Response(cli.stderr).text()]);
			expect(exit).toBe(0);
			expect(stderr).toBe("");
			const html = await readFile(output, "utf8");
			expect(html).toContain(`"taskCount":${count}`);
			const data = JSON.parse(
				html.match(/<script type="application\/json" id="backlog-snapshot">([\s\S]*?)<\/script>/)?.[1] ?? "null",
			) as { tasks: Task[] };
			expect(data.tasks).toHaveLength(count);
			expect(JSON.stringify(data)).not.toContain("PRIVATE_COMMAND");
			expect(JSON.stringify(data)).not.toContain("PRIVATE_TOKEN");
			expect(data.tasks[0]).not.toHaveProperty("onStatusChange");
			expect(data.tasks[0]).not.toHaveProperty("filePath");
			expect(data.tasks[0]).not.toHaveProperty("unknownFields");
			const verification = Bun.spawn(
				["node", resolve(import.meta.dir, "../../scripts/verify-html-snapshot.mjs"), output, String(count)],
				{
					cwd: resolve(import.meta.dir, "../.."),
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const [verified, verificationError] = await Promise.all([
				verification.exited,
				new Response(verification.stderr).text(),
			]);
			if (verified !== 0) throw new Error(verificationError.slice(0, 3000));
			expect(verified).toBe(0);
			expect(verificationError).toBe("");
		} finally {
			await rm(project, { recursive: true, force: true });
		}
	}, 30000);

test("escapes HTML script delimiters and Unicode line separators in embedded JSON", () => {
	const embedded = escapeEmbeddedJson({ value: "</script><script>evil()</script>\u2028\u2029&" });
	expect(embedded).not.toContain("<");
	expect(embedded).not.toContain(">");
	expect(embedded).not.toContain("&");
	expect(embedded).not.toContain("\u2028");
	expect(embedded).not.toContain("\u2029");
	expect(JSON.parse(embedded)).toEqual({ value: "</script><script>evil()</script>\u2028\u2029&" });
});

test.skipIf(process.platform === "win32")("refuses task symlinks that leave the project", async () => {
	const project = await mkdtemp(join(tmpdir(), "backlog-html-symlink-"));
	const external = await mkdtemp(join(tmpdir(), "backlog-html-external-"));
	try {
		const core = new Core(project);
		await core.filesystem.ensureBacklogStructure();
		await core.filesystem.saveConfig({
			projectName: "Symlink test",
			statuses: [],
			labels: [],
			milestones: [],
			dateFormat: "YYYY-MM-DD",
			filesystemOnly: true,
		});
		const outside = join(external, "task-1.md");
		await writeFile(
			outside,
			serializeTask(
				{
					id: "TASK-1",
					title: "Private",
					status: "To Do",
					assignee: [],
					labels: [],
					createdDate: "2026-01-01",
					dependencies: [],
				},
				"",
				undefined,
				core.filesystem.taskSchema,
			),
		);
		await symlink(outside, join(core.filesystem.tasksDir, "task-1 - Linked.md"));
		await expect(createHtmlSnapshot(core)).rejects.toThrow("resolves outside the project");
	} finally {
		await rm(project, { recursive: true, force: true });
		await rm(external, { recursive: true, force: true });
	}
});
