import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../index.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createUniqueTestDir, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const CLI_PATH = getTestCliPath();

let TEST_DIR: string;

async function runCli(args: string[], cwd = TEST_DIR) {
	return await $`bun ${[CLI_PATH, ...args]}`.cwd(cwd).nothrow().quiet();
}

describe("CLI JSON output", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-cli-json-output");
		await mkdir(TEST_DIR, { recursive: true });

		const core = new Core(TEST_DIR);
		await initializeFilesystemTestProject(core, "JSON Output Test");
		await core.createTask(
			{
				id: "task-1",
				title: "JSON task",
				status: "In Progress",
				type: "enhancement",
				priority: "high",
				assignee: ["@alex"],
				reporter: "@sam",
				createdDate: "2026-07-14 09:30",
				updatedDate: "2026-07-14 10:45",
				dueDate: "2026-08-10",
				labels: ["cli", "json"],
				milestone: "m-1",
				dependencies: ["TASK-2"],
				references: ["https://example.com/issue"],
				documentation: ["doc-1"],
				modifiedFiles: ["src/cli.ts"],
				description: "Machine-readable output",
				implementationPlan: "1. Add formatter",
				implementationNotes: "Formatter added",
				finalSummary: "Ready for review",
				acceptanceCriteriaItems: [{ index: 1, text: "Produces JSON", checked: true }],
				definitionOfDoneItems: [{ index: 1, text: "Tests pass", checked: false }],
				comments: [{ index: 1, body: "Keep this stable", createdDate: "2026-07-14 11:00", author: "@alex" }],
				ordinal: 1000,
				branch: "secret-branch",
				rawContent: "internal markdown",
				source: "local",
				onStatusChange: "echo secret",
			},
			false,
		);

		await core.filesystem.saveDocument({
			id: "doc-1",
			title: "JSON guide",
			type: "guide",
			createdDate: "2026-07-13",
			updatedDate: "2026-07-14 08:00",
			rawContent: "JSON task documentation",
			tags: ["cli"],
			path: "guides/json.md",
		});

		await core.filesystem.saveDecision({
			id: "decision-1",
			title: "Use stable JSON",
			date: "2026-07-12",
			status: "accepted",
			context: "JSON task consumers need stability",
			decision: "Publish curated fields",
			consequences: "Version the contract",
			rawContent: "JSON task decision",
		});
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("returns a compact versioned task-list envelope", async () => {
		const result = await runCli(["task", "list", "--json"]);
		expect(result.exitCode).toBe(0);
		expect(result.stderr.toString()).toBe("");
		expect(result.stdout.toString().endsWith("\n")).toBe(true);

		const output = JSON.parse(result.stdout.toString());
		expect(output.schemaVersion).toBe(2);
		expect(output.kind).toBe("task-list");
		expect(output.tasks).toHaveLength(1);
		expect(output.tasks[0]).toMatchObject({
			id: "TASK-1",
			title: "JSON task",
			fields: {
				status: "In Progress",
				type: "enhancement",
				priority: "high",
				assignee: ["@alex"],
				reporter: "@sam",
				labels: ["cli", "json"],
				milestone: "m-1",
				dependencies: ["TASK-2"],
				references: ["https://example.com/issue"],
				modified_files: ["src/cli.ts"],
				ordinal: 1000,
				due_date: "2026-08-10",
				onStatusChange: "echo secret",
			},
			unknownFields: {},
		});
		expect(output.tasks[0]).not.toHaveProperty("status");
		expect(output.tasks[0]).not.toHaveProperty("customFields");
		expect(result.stdout.toString()).not.toContain("rawContent");
		expect(result.stdout.toString()).not.toContain("secret-branch");
	});

	it("omits absent list fields and emits unknownFields for tasks without them", async () => {
		const core = new Core(TEST_DIR);
		await core.createTask(
			{
				id: "TASK-3",
				title: "Bare task",
				status: "To Do",
				assignee: [],
				createdDate: "2026-07-15 08:00",
				labels: [],
				dependencies: [],
				rawContent: "",
			},
			false,
		);
		const result = await runCli(["task", "list", "--json"]);
		expect(result.exitCode).toBe(0);
		const bare = JSON.parse(result.stdout.toString()).tasks.find((t: { id: string }) => t.id === "TASK-3");
		expect(bare.fields.references).toBeUndefined();
		expect(bare.fields.modified_files).toBeUndefined();
		expect(bare.fields.dependencies).toEqual([]);
		expect(bare.unknownFields).toEqual({});
	});

	it("returns a compact versioned decision-list envelope", async () => {
		const result = await runCli(["decision", "list", "--json"]);
		expect(result.exitCode).toBe(0);
		expect(result.stderr.toString()).toBe("");
		expect(result.stdout.toString().endsWith("\n")).toBe(true);

		expect(JSON.parse(result.stdout.toString())).toEqual({
			schemaVersion: 1,
			kind: "decision-list",
			decisions: [
				{
					id: "decision-1",
					title: "Use stable JSON",
					status: "accepted",
					date: "2026-07-12",
				},
			],
		});
		expect(result.stdout.toString()).not.toContain("rawContent");
		expect(result.stdout.toString()).not.toContain("Publish curated fields");
	});

	it("returns a versioned draft-list envelope in the plain output order", async () => {
		const empty = await runCli(["draft", "list", "--json"]);
		expect(empty.exitCode).toBe(0);
		expect(JSON.parse(empty.stdout.toString())).toEqual({ schemaVersion: 2, kind: "draft-list", drafts: [] });

		const core = new Core(TEST_DIR);
		for (const [id, title, priority] of [
			["DRAFT-1", "Low draft", "low"],
			["DRAFT-2", "High draft", "high"],
		] as const) {
			await core.filesystem.saveDraft({
				id,
				title,
				status: "Draft",
				priority,
				assignee: [],
				labels: [],
				dependencies: [],
				createdDate: "2026-08-08",
				rawContent: "secret body",
			});
		}

		const result = await runCli(["draft", "list", "--json"]);
		expect(result.exitCode).toBe(0);
		expect(result.stderr.toString()).toBe("");
		const output = JSON.parse(result.stdout.toString());
		expect(output.kind).toBe("draft-list");
		const jsonIds = output.drafts.map((draft: { id: string }) => draft.id);
		expect(jsonIds).toEqual(["DRAFT-2", "DRAFT-1"]);
		const plain = await runCli(["draft", "list", "--plain"]);
		expect(plain.stdout.toString().match(/DRAFT-\d+/g)).toEqual(jsonIds);
		expect(output.drafts[0]).toMatchObject({
			title: "High draft",
			fields: { status: "Draft", priority: "high" },
			unknownFields: {},
		});
		// Readiness is derived against tasks only, so a draft entry never carries it.
		for (const draft of output.drafts) expect(draft).not.toHaveProperty("isReady");
		expect(result.stdout.toString()).not.toContain("secret body");

		const byId = await runCli(["draft", "list", "--json", "--sort", "id"]);
		expect(JSON.parse(byId.stdout.toString()).drafts.map((draft: { id: string }) => draft.id)).toEqual([
			"DRAFT-1",
			"DRAFT-2",
		]);
		const invalid = await runCli(["draft", "list", "--json", "--sort", "nope"]);
		expect(invalid.exitCode).toBe(1);
		expect(invalid.stdout.toString()).toBe("");
	});

	it("returns curated task details for view and shorthand", async () => {
		for (const args of [
			["task", "view", "1", "--json"],
			["task", "1", "--json"],
		]) {
			const result = await runCli(args);
			expect(result.exitCode).toBe(0);
			const output = JSON.parse(result.stdout.toString());
			expect(output.schemaVersion).toBe(2);
			expect(output.kind).toBe("task-view");
			expect(output.task.path).toMatch(/^backlog\/tasks\/task-1 - JSON-task\.md$/);
			expect(output.task.fields.dependencies).toEqual(["TASK-2"]);
			expect(output.task.fields.due_date).toBe("2026-08-10");
			expect(output.task.unknownFields).toEqual({});
			expect(output.task.rawContent).toBeUndefined();
			expect(output.task.filePath).toBeUndefined();
			expect(output.task.branch).toBeUndefined();
		}
	});

	it("marks a task in the archive as archived in task view", async () => {
		expect(await new Core(TEST_DIR).archiveTask("task-1", false)).toBe(true);

		const result = await runCli(["task", "view", "1", "--json"]);

		expect(result.exitCode).toBe(0);
		const output = JSON.parse(result.stdout.toString());
		expect(output.schemaVersion).toBe(2);
		expect(output.task.fields.status).toBe("In Progress");
		expect(output.task.path).toMatch(/^backlog\/archive\/tasks\/task-1 - JSON-task\.md$/);
	});

	it("serializes an absent description as an empty section and preserves Markdown verbatim", async () => {
		const withoutDescription = await runCli(["task", "create", "No description", "--plain"]);
		expect(withoutDescription.exitCode).toBe(0);
		const withMarkdown = await runCli([
			"task",
			"create",
			"Markdown description",
			"--description",
			"First line\n\n- item with `code`",
			"--plain",
		]);
		expect(withMarkdown.exitCode).toBe(0);

		const absent = await runCli(["task", "view", "2", "--json"]);
		expect(absent.exitCode).toBe(0);
		expect(JSON.parse(absent.stdout.toString()).task.sections.description).toBe("");

		const markdown = await runCli(["task", "view", "3", "--json"]);
		expect(markdown.exitCode).toBe(0);
		expect(JSON.parse(markdown.stdout.toString()).task.sections.description).toBe("First line\n\n- item with `code`");
	});

	it("preserves heterogeneous search rank and omits scores", async () => {
		const result = await runCli(["search", "JSON task", "--json"]);
		expect(result.exitCode).toBe(0);
		const output = JSON.parse(result.stdout.toString());
		expect(output.schemaVersion).toBe(2);
		expect(output.kind).toBe("search");
		expect(output.results.map((entry: { type: string }) => entry.type)).toEqual(["task", "document", "decision"]);
		expect(output.results[0].data.id).toBe("TASK-1");
		expect(output.results[0].data.fields.status).toBe("In Progress");
		expect(output.results[0].data.fields.dependencies).toEqual(["TASK-2"]);
		expect(output.results[0].data.unknownFields).toEqual({});
		expect(output.results[1].data).toEqual({
			id: "doc-1",
			title: "JSON guide",
			type: "guide",
			path: "backlog/docs/doc-1 - JSON-guide.md",
			tags: ["cli"],
			createdAt: "2026-07-13",
			updatedAt: "2026-07-14T08:00:00Z",
		});
		expect(output.results[2].data).toEqual({
			id: "decision-1",
			title: "Use stable JSON",
			status: "accepted",
			date: "2026-07-12",
		});
		for (const entry of output.results) {
			expect(entry.score).toBeUndefined();
		}
	});

	it("returns checklist sections in views and compact field objects in lists and search", async () => {
		const core = new Core(TEST_DIR);
		await core.updateTaskFromInput(
			"task-1",
			{
				addSectionItems: { acceptance: ["Produces JSON"] },
				checkSectionItems: { acceptance: [1] },
			},
			false,
		);
		await core.createTask(
			{
				id: "task-2",
				title: "Partial JSON task",
				status: "To Do",
				assignee: [],
				createdDate: "2026-07-15 09:00",
				labels: [],
				dependencies: [],
				sections: {
					acceptance: [
						{ index: 1, text: "Finished", checked: true },
						{ index: 2, text: "Pending", checked: false },
					],
				},
			},
			false,
		);
		await core.createTask(
			{
				id: "task-3",
				title: "Empty JSON task",
				status: "To Do",
				assignee: [],
				createdDate: "2026-07-15 10:00",
				labels: [],
				dependencies: [],
			},
			false,
		);

		const expectedSections = {
			"TASK-1": [{ index: 1, text: "Produces JSON", checked: true }],
			"TASK-2": [
				{ index: 1, text: "Finished", checked: true },
				{ index: 2, text: "Pending", checked: false },
			],
			"TASK-3": [],
		};

		const list = await runCli(["task", "list", "--json"]);
		expect(list.exitCode).toBe(0);
		const listed = JSON.parse(list.stdout.toString()).tasks;
		expect(listed).toHaveLength(3);
		for (const task of listed) {
			expect(task.fields).toBeDefined();
			expect(task.sections).toBeUndefined();
			expect(task.acceptanceCriteriaCount).toBeUndefined();
		}

		for (const id of ["1", "2", "3"]) {
			const view = await runCli(["task", "view", id, "--json"]);
			expect(view.exitCode).toBe(0);
			const task = JSON.parse(view.stdout.toString()).task;
			expect(task.sections.acceptance).toEqual(expectedSections[task.id as keyof typeof expectedSections]);
			expect(typeof task.other).toBe("string");
		}

		const search = await runCli(["search", "JSON task", "--json"]);
		expect(search.exitCode).toBe(0);
		const taskResults = JSON.parse(search.stdout.toString()).results.filter(
			(result: { type: string }) => result.type === "task",
		);
		for (const result of taskResults) {
			expect(result.data.fields).toBeDefined();
			expect(result.data.sections).toBeUndefined();
		}
	});

	it("reads no task corpus for a search that matched no task", async () => {
		// An archived record that cannot be parsed is never cached, so it is re-read and re-logged
		// under DEBUG on every load of the archived corpus. Counting those lines counts the corpus
		// reads one command makes.
		await writeFile(
			join(TEST_DIR, "backlog", "archive", "tasks", "task-99 - Broken.md"),
			"---\nid: TASK-99\ntitle: [unclosed\nstatus: Done\n---\n\nbroken\n",
		);
		const corpusReads = async (args: string[]) => {
			const result = await $`bun ${[CLI_PATH, ...args]}`
				.cwd(TEST_DIR)
				.env({ ...process.env, DEBUG: "1" })
				.quiet();
			expect(result.exitCode).toBe(0);
			return {
				stdout: result.stdout.toString(),
				reads: result.stderr
					.toString()
					.split("\n")
					.filter((line) => line.startsWith("Failed to parse archived task file")).length,
			};
		};

		const asJson = await corpusReads(["search", "JSON", "--type", "document", "--json"]);
		const asPlain = await corpusReads(["search", "JSON", "--type", "document", "--plain"]);
		expect(JSON.parse(asJson.stdout).results.every((entry: { type: string }) => entry.type === "document")).toBe(true);
		// Nothing in that payload carries readiness, so nothing loads the corpus it comes from.
		expect(asJson.reads).toBe(asPlain.reads);
	});

	it("uses the configured project-relative docs directory in search paths", async () => {
		const customTestDir = createUniqueTestDir("test-cli-json-output-custom-dir");
		try {
			await mkdir(customTestDir, { recursive: true });

			const core = new Core(customTestDir);
			await initializeFilesystemTestProject(core, "Custom JSON Output Test", "planning/backlog-data");
			await core.filesystem.saveDocument({
				id: "doc-1",
				title: "Custom guide",
				type: "guide",
				createdDate: "2026-07-15",
				rawContent: "Custom directory JSON documentation",
			});

			const result = await runCli(["search", "Custom directory JSON", "--json"], customTestDir);
			expect(result.exitCode).toBe(0);
			expect(result.stderr.toString()).toBe("");
			const output = JSON.parse(result.stdout.toString());
			expect(output.results).toHaveLength(1);
			expect(output.results[0].data.path).toBe("planning/backlog-data/docs/doc-1 - Custom-guide.md");
		} finally {
			await safeCleanup(customTestDir);
		}
	});

	it("returns successful empty envelopes", async () => {
		const list = await runCli(["task", "list", "--status", "Done", "--json"]);
		expect(JSON.parse(list.stdout.toString())).toEqual({ schemaVersion: 2, kind: "task-list", tasks: [] });

		const search = await runCli(["search", "no-such-content", "--json"]);
		expect(JSON.parse(search.stdout.toString())).toEqual({ schemaVersion: 2, kind: "search", results: [] });
	});

	it("rejects conflicting output modes without stdout", async () => {
		for (const args of [
			["task", "list", "--json", "--plain"],
			["task", "view", "1", "--json", "--plain"],
			["task", "1", "--json", "--plain"],
			["search", "JSON", "--json", "--plain"],
			["decision", "list", "--json", "--plain"],
			["draft", "list", "--json", "--plain"],
		]) {
			const result = await runCli(args);
			expect(result.exitCode).toBe(1);
			expect(result.stdout.toString()).toBe("");
			expect(result.stderr.toString()).toContain("--json cannot be combined with --plain");
		}
	});

	it("treats output-looking search terms after -- as literal queries", async () => {
		const json = await runCli(["search", "--json", "--", "--plain"]);
		expect(json.exitCode).toBe(0);
		expect(json.stderr.toString()).toBe("");
		expect(JSON.parse(json.stdout.toString())).toEqual({ schemaVersion: 2, kind: "search", results: [] });

		const plain = await runCli(["search", "--plain", "--", "--json"]);
		expect(plain.exitCode).toBe(0);
		expect(plain.stderr.toString()).toBe("");
		expect(plain.stdout.toString()).toContain("TASK-1 - JSON task");
	});

	it("rejects --json on unsupported task subcommands", async () => {
		for (const args of [
			["task", "archive", "999", "--json"],
			["task", "--json", "archive", "999"],
		]) {
			const result = await runCli(args);
			expect(result.exitCode).toBe(1);
			expect(result.stdout.toString()).toBe("");
			expect(result.stderr.toString()).toContain("--json");
			expect(result.stderr.toString()).not.toContain("Task 999 not found");
		}
	});

	it("uses stderr and a nonzero exit for JSON errors", async () => {
		for (const args of [
			["task", "view", "999", "--json"],
			["task", "999", "--json"],
			["task", "list", "--limit", "0", "--json"],
		]) {
			const result = await runCli(args);
			expect(result.exitCode).toBe(1);
			expect(result.stdout.toString()).toBe("");
			expect(result.stderr.toString().length).toBeGreaterThan(0);
		}
	});

	it("is parseable through a shell pipe", async () => {
		const result =
			await $`bun ${CLI_PATH} task list --json | bun -e ${"const value = await Bun.stdin.json(); console.log(value.kind);"}`
				.cwd(TEST_DIR)
				.nothrow()
				.quiet();
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toBe("task-list\n");
	});

	it("documents JSON mode in command help", async () => {
		for (const args of [
			["task", "list", "--help"],
			["task", "view", "--help"],
			["task", "--help"],
			["search", "--help"],
			["decision", "list", "--help"],
			["draft", "list", "--help"],
		]) {
			const result = await runCli(args);
			expect(result.exitCode).toBe(0);
			expect(result.stdout.toString()).toContain("--json");
		}
	});
});
