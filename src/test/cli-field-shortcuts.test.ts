import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { getTestCliPath } from "./test-cli.ts";
import { initializeFilesystemTestProject } from "./test-utils.ts";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function run(directory: string, args: string[]): string {
	const result = Bun.spawnSync({
		cmd: [process.execPath, getTestCliPath(), ...args],
		cwd: directory,
		env: { ...process.env, BACKLOG_CWD: directory },
	});
	const stderr = result.stderr.toString();
	expect(result.exitCode, stderr).toBe(0);
	return result.stdout.toString();
}

function createdFile(output: string): string {
	const path = output.match(/^File: (.+)$/m)?.[1];
	if (!path) throw new Error(`Missing created file path in ${output}`);
	return path;
}

function stableContent(content: string): string {
	return content.replace(/^(created_date|updated_date): .*$/gm, "$1: <generated timestamp>");
}

describe("task field shortcuts", () => {
	const cases: Array<{ flag: string[]; field: string; needsTask?: boolean }> = [
		{ flag: ["-s", "Done"], field: "status=Done" },
		{ flag: ["-a", "@tester"], field: "assignee=@tester" },
		{ flag: ["--priority", "high"], field: "priority=high" },
		{ flag: ["--type", "bug"], field: "type=bug" },
		{ flag: ["--project", "Client"], field: "project=Client" },
		{ flag: ["-l", "urgent,review"], field: "labels=urgent,review" },
		{ flag: ["--milestone", "m-1"], field: "milestone=m-1" },
		{ flag: ["-p", "task-1"], field: "parent_task_id=task-1", needsTask: true },
		{ flag: ["--dep", "task-1"], field: "dependencies=task-1", needsTask: true },
		{ flag: ["--due-date", "2026-11-01"], field: "due_date=2026-11-01" },
		{ flag: ["--reporter", "@tester"], field: "reporter=@tester" },
		{ flag: ["--ordinal", "42"], field: "ordinal=42" },
	];
	for (const entry of cases) {
		test(`${entry.flag[0]} create writes the same task file as --field ${entry.field}`, async () => {
			const directory = mkdtempSync(join(tmpdir(), "backlog-shortcut-"));
			directories.push(directory);
			const core = new Core(directory);
			await initializeFilesystemTestProject(core, "Shortcut test");
			const schemaPath = join(directory, "backlog", "task-schema.yml");
			writeFileSync(
				schemaPath,
				readFileSync(schemaPath, "utf8").replace(
					"project: {type: enum, core: true, values: []",
					"project: {type: enum, core: true, values: [Client]",
				),
			);
			if (entry.needsTask) await core.createTaskFromInput({ title: "Existing" });
			const aliasPath = createdFile(run(directory, ["task", "create", "Equivalent", ...entry.flag]));
			const aliasContent = readFileSync(aliasPath, "utf8");
			rmSync(aliasPath);
			const fieldPath = createdFile(run(directory, ["task", "create", "Equivalent", "--field", entry.field]));
			expect(fieldPath).toBe(aliasPath);
			expect(stableContent(readFileSync(fieldPath, "utf8")), entry.flag.join(" ")).toBe(stableContent(aliasContent));
		});
	}

	test("--clear-due-date writes the same file as --clear-field due_date", async () => {
		const directory = mkdtempSync(join(tmpdir(), "backlog-shortcut-clear-"));
		directories.push(directory);
		const core = new Core(directory);
		await initializeFilesystemTestProject(core, "Shortcut clear test");
		const { filePath } = await core.createTaskFromInput({ title: "Equivalent", dueDate: "2026-11-01" });
		if (!filePath) throw new Error("Missing task file");
		const original = readFileSync(filePath, "utf8");
		run(directory, ["task", "edit", "task-1", "--clear-due-date"]);
		const aliasContent = readFileSync(filePath, "utf8");
		writeFileSync(filePath, original);
		run(directory, ["task", "edit", "task-1", "--clear-field", "due_date"]);
		expect(stableContent(readFileSync(filePath, "utf8"))).toBe(stableContent(aliasContent));
	});
});
