import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../core/backlog.ts";
import { getTestCliPath } from "./test-cli.ts";
import {
	createUniqueTestDir,
	initializeFilesystemTestProject,
	initializeTestProject,
	safeCleanup,
	updateTestTaskSchema,
} from "./test-utils.ts";

const CLI_PATH = getTestCliPath();
const NOT_APPLIED = "No changes were applied.";

let TEST_DIR: string;

async function runCli(args: string[]) {
	const result = await $`bun ${CLI_PATH} ${args}`.cwd(TEST_DIR).quiet().nothrow();
	return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

/** Every task and draft file with its exact bytes, so a comparison also catches added or removed files. */
async function readRecordFiles(): Promise<Record<string, Buffer>> {
	const files: Record<string, Buffer> = {};
	for (const directory of ["tasks", "drafts"]) {
		const directoryPath = join(TEST_DIR, "backlog", directory);
		for (const name of (await readdir(directoryPath)).sort()) {
			files[`${directory}/${name}`] = await readFile(join(directoryPath, name));
		}
	}
	return files;
}

type RejectedEdit = { name: string; args: string[]; reason: string };

// Each task edit carries a valid field next to the rejected part, as in issue #1061: the valid
// field must be discarded with the rest.
const REJECTED_TASK_EDITS: RejectedEdit[] = [
	{
		name: "an out-of-range checklist index next to valid fields",
		args: [
			...["task", "edit", "1", "--section", "description=hand-off notes"],
			...["--modified-file", "src/a.ts", "--ref", "docs/a.md", "--check", "acceptance:1", "--check", "acceptance:2"],
			...["--check", "acceptance:3"],
		],
		reason: "Section 'acceptance' has no item #3",
	},
	{
		name: "an out-of-range --check index",
		args: ["task", "edit", "1", "--section", "description=hand-off notes", "--check", "acceptance:9"],
		reason: "Section 'acceptance' has no item #9",
	},
	{
		name: "an index that is not a number",
		args: ["task", "edit", "1", "--section", "description=hand-off notes", "--check", "acceptance:zero"],
		reason: "Invalid --check",
	},
	{
		name: "a log entry with a reserved delimiter line",
		args: ["task", "edit", "1", "--section", "description=hand-off notes", "--comment", "first line\n---\nsecond line"],
		reason: "Log body cannot contain a standalone '---' line.",
	},
	{
		name: "an unknown option",
		args: ["task", "edit", "1", "--section", "description=hand-off notes", "--bogus"],
		reason: "unknown option '--bogus'",
	},
	{
		name: "an option without its value",
		args: ["task", "edit", "1", "--title", "Renamed", "--section"],
		reason: "argument missing",
	},
	{
		name: "--json given to the parent command",
		args: ["task", "--json", "edit", "1", "--section", "description=hand-off notes"],
		reason: "unknown option '--json'",
	},
	{
		name: "flags that cannot be combined",
		args: ["task", "edit", "1", "--section", "description=hand-off notes", "--label", "a", "--add-label", "b"],
		reason: "Cannot combine --label with --add-label",
	},
	{
		name: "a task ID that does not exist",
		args: ["task", "edit", "999", "--section", "description=hand-off notes"],
		reason: "Task 999 not found",
	},
	{
		name: "a missing task ID",
		args: ["task", "edit", "--section", "description=hand-off notes"],
		reason: "missing required argument 'taskId'",
	},
	{
		name: "several task IDs with a flag limited to one task",
		args: ["task", "edit", "1", "2", "--add-label", "triage", "-t", "Same title"],
		reason: "--title applies to one task only",
	},
];

const REJECTED_DRAFT_EDITS: RejectedEdit[] = [
	{
		name: "an out-of-range --check index",
		args: ["draft", "edit", "DRAFT-1", "--section", "description=draft notes", "--check", "acceptance:4"],
		reason: "Section 'acceptance' has no item #4",
	},
	{
		name: "an unknown option",
		args: ["draft", "edit", "DRAFT-1", "--section", "description=draft notes", "--bogus"],
		reason: "unknown option '--bogus'",
	},
	{
		name: "a status other than Draft",
		args: ["draft", "edit", "DRAFT-1", "--section", "description=draft notes", "-s", "In Progress"],
		reason: "Invalid status: In Progress",
	},
];

describe("an edit that is not applied", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-cli-edit-not-applied");
		await mkdir(TEST_DIR, { recursive: true });
		const core = new Core(TEST_DIR);
		await initializeFilesystemTestProject(core, "Edit Not Applied Project");
		await updateTestTaskSchema(core.filesystem, (schema) => {
			schema.users = [{ handle: "@reviewer", name: "Reviewer", default: true }];
		});
		await core.createTaskFromInput(
			{
				title: "First task",
				sectionItems: { acceptance: ["First criterion", "Second criterion"] },
			},
			false,
		);
		await core.createTaskFromInput({ title: "Second task" }, false);
		await core.createTaskFromInput({ title: "First draft", status: "Draft" }, false);
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	for (const [command, rejectedEdits] of [
		["task edit", REJECTED_TASK_EDITS],
		["draft edit", REJECTED_DRAFT_EDITS],
	] as const) {
		for (const { name, args, reason } of rejectedEdits) {
			it(`${command} says so and changes no file when it rejects ${name}`, async () => {
				const before = await readRecordFiles();

				const result = await runCli(args);

				expect(result.exitCode).not.toBe(0);
				expect(result.stderr).toContain(reason);
				// Splitting on the sentence gives two parts exactly when it appears once.
				expect(result.stderr.split(NOT_APPLIED)).toHaveLength(2);
				expect(result.stdout).toBe("");
				expect(await readRecordFiles()).toEqual(before);
			});
		}
	}

	it("keeps the output of a successful task edit unchanged", async () => {
		const result = await runCli([
			"task",
			"edit",
			"1",
			"--section",
			"description=hand-off notes",
			"--check",
			"acceptance:1",
		]);

		expect(result).toEqual({ exitCode: 0, stdout: "Updated task TASK-1\n", stderr: "" });
	});

	it("keeps the output of a successful draft edit unchanged", async () => {
		const result = await runCli(["draft", "edit", "DRAFT-1", "--section", "description=draft notes"]);

		expect(result).toEqual({ exitCode: 0, stdout: "Updated draft DRAFT-1\n", stderr: "" });
	});

	it("keeps the plain output of a successful edit free of the sentence", async () => {
		const result = await runCli(["task", "edit", "1", "--section", "description=hand-off notes", "--plain"]);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("Task TASK-1 - First task");
		expect(result.stdout).not.toContain(NOT_APPLIED);
	});

	it.each([
		["1", "999"],
		["999", "1"],
	])("keeps the per-task output when editing %s then %s partly succeeds", async (firstId, secondId) => {
		const result = await runCli(["task", "edit", firstId, secondId, "-s", "In Progress"]);

		expect(result.exitCode).not.toBe(0);
		expect(result.stdout).toBe("Updated task TASK-1\n");
		expect(result.stderr).toContain("Failed to update 999: Task 999 not found");
		expect(result.stderr).not.toContain(NOT_APPLIED);
		expect((await new Core(TEST_DIR).filesystem.loadTask("task-1"))?.status).toBe("In Progress");
	});
});

describe("an edit that is saved but fails afterwards", () => {
	let taskFilePath: string;
	let draftFilePath: string;

	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-cli-edit-saved-not-committed");
		await mkdir(TEST_DIR, { recursive: true });
		await $`git init -b main`.cwd(TEST_DIR).quiet();
		const core = new Core(TEST_DIR);
		await initializeTestProject(core, "Edit Saved Project", true);
		const config = await core.filesystem.loadConfig();
		if (!config) throw new Error("Expected the test project config");
		await core.filesystem.saveConfig({ ...config, autoCommit: true });
		const { filePath } = await core.createTaskFromInput({ title: "Saved task" }, false);
		if (!filePath) throw new Error("Expected the created task file path");
		taskFilePath = filePath;
		const draft = await core.createTaskFromInput({ title: "Saved draft", status: "Draft" }, false);
		if (!draft.filePath) throw new Error("Expected the created draft file path");
		draftFilePath = draft.filePath;
		await $`git add -A`.cwd(TEST_DIR).quiet();
		await $`git commit -m baseline`.cwd(TEST_DIR).quiet();

		// Auto-commit runs after the task file is saved, so a hook that refuses every commit makes
		// the edit fail with its changes already on disk.
		const hookPath = join(TEST_DIR, ".git", "hooks", "pre-commit");
		await mkdir(join(TEST_DIR, ".git", "hooks"), { recursive: true });
		await writeFile(hookPath, "#!/bin/sh\nexit 1\n");
		await chmod(hookPath, 0o755);
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("does not say that no changes were applied", async () => {
		const before = await readFile(taskFilePath);

		const result = await runCli(["task", "edit", "1", "--section", "description=saved but not committed"]);

		expect(result.exitCode).not.toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).not.toContain(NOT_APPLIED);
		const after = await readFile(taskFilePath);
		expect(after.equals(before)).toBe(false);
		expect(after.toString()).toContain("saved but not committed");
	});

	it("does not say that no changes were applied after a draft rename", async () => {
		const result = await runCli(["draft", "edit", "DRAFT-1", "--title", "Renamed draft"]);

		expect(result.exitCode).not.toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).not.toContain(NOT_APPLIED);
		const draft = await new Core(TEST_DIR).filesystem.loadDraft("DRAFT-1");
		expect(draft?.title).toBe("Renamed draft");
		expect(draft?.filePath).not.toBe(draftFilePath);
		expect(await Bun.file(draftFilePath).exists()).toBe(false);
	});
});
