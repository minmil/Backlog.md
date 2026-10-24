import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { $ } from "bun";
import { Core } from "../core/backlog.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createUniqueTestDir, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const CLI_PATH = getTestCliPath();

// Runs the CLI with stdio reported as a TTY so interactive-only behavior (the edit wizard) applies.
async function runCliWithInteractiveTty(cwd: string, args: string[]) {
	const entryPath = join(cwd, "interactive-cli-entry.ts");
	await writeFile(
		entryPath,
		`Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
await import(${JSON.stringify(pathToFileURL(CLI_PATH).href)});
`,
	);
	return await $`bun ${entryPath} ${args}`.cwd(cwd).quiet().nothrow();
}

describe("CLI dependency options", () => {
	let testDir: string;
	let core: Core;

	beforeEach(async () => {
		testDir = createUniqueTestDir("test-cli-dependency");
		await mkdir(testDir, { recursive: true });
		core = new Core(testDir);
		await initializeFilesystemTestProject(core, "CLI dependency options");
	});

	afterEach(async () => {
		await safeCleanup(testDir);
	});

	it("creates and edits dependencies through both public flags", async () => {
		await $`bun ${CLI_PATH} task create "Base task one"`.cwd(testDir).quiet();
		await $`bun ${CLI_PATH} task create "Base task two"`.cwd(testDir).quiet();

		const created = await $`bun ${CLI_PATH} task create "Dependent task" --dep 1 --plain`.cwd(testDir).quiet();
		expect(created.stdout.toString()).toContain("Task TASK-3 - Dependent task");
		expect((await core.filesystem.loadTask("TASK-3"))?.dependencies).toEqual(["TASK-1"]);

		const edited = await $`bun ${CLI_PATH} task edit 3 --depends-on TASK-1,TASK-2 --plain`.cwd(testDir).quiet();
		expect(edited.stdout.toString()).toContain("Task TASK-3 - Dependent task");
		expect((await core.filesystem.loadTask("TASK-3"))?.dependencies).toEqual(["TASK-1", "TASK-2"]);

		// Task detail shows the resolved graph instead of repeating the raw ID list.
		const viewed = await $`bun ${CLI_PATH} task view 3 --plain`.cwd(testDir).quiet();
		expect(viewed.stdout.toString()).toContain("Dependency Graph:");
		expect(viewed.stdout.toString()).toContain("TASK-1");
		expect(viewed.stdout.toString()).toContain("TASK-2");
	});

	it("accumulates repeated dependency flags", async () => {
		await $`bun ${CLI_PATH} task create "Base task one"`.cwd(testDir).quiet();
		await $`bun ${CLI_PATH} task create "Base task two"`.cwd(testDir).quiet();

		await $`bun ${CLI_PATH} task create "Dependent task" --depends-on TASK-1 --depends-on TASK-2`.cwd(testDir).quiet();

		expect((await core.filesystem.loadTask("TASK-3"))?.dependencies).toEqual(["TASK-1", "TASK-2"]);
	});

	it("merges --depends-on and --dep on task create", async () => {
		await $`bun ${CLI_PATH} task create "Base task one"`.cwd(testDir).quiet();
		await $`bun ${CLI_PATH} task create "Base task two"`.cwd(testDir).quiet();

		await $`bun ${CLI_PATH} task create "Dependent task" --depends-on TASK-1 --dep TASK-2`.cwd(testDir).quiet();

		expect((await core.filesystem.loadTask("TASK-3"))?.dependencies).toEqual(["TASK-1", "TASK-2"]);
	});

	it("clears dependencies with --clear-deps", async () => {
		await $`bun ${CLI_PATH} task create "Base task"`.cwd(testDir).quiet();
		await $`bun ${CLI_PATH} task create "Dependent task" --depends-on TASK-1`.cwd(testDir).quiet();

		const result = await $`bun ${CLI_PATH} task edit 2 --clear-deps --plain`.cwd(testDir).quiet();

		expect(result.exitCode).toBe(0);
		expect((await core.filesystem.loadTask("TASK-2"))?.dependencies).toEqual([]);
	});

	it("clears dependencies with --clear-deps in an interactive terminal", async () => {
		await $`bun ${CLI_PATH} task create "Base task"`.cwd(testDir).quiet();
		await $`bun ${CLI_PATH} task create "Dependent task" --depends-on TASK-1`.cwd(testDir).quiet();

		const result = await runCliWithInteractiveTty(testDir, ["task", "edit", "2", "--clear-deps"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toContain("Updated task TASK-2");
		expect((await core.filesystem.loadTask("TASK-2"))?.dependencies).toEqual([]);
	});

	// On edit an explicit empty value is the second spelling of --clear-deps, matching `-a ""`.
	it("clears dependencies with an explicit empty value", async () => {
		await $`bun ${CLI_PATH} task create "Base task"`.cwd(testDir).quiet();
		await $`bun ${CLI_PATH} task create "Dependent task" --depends-on TASK-1`.cwd(testDir).quiet();

		const emptyDependsOn = await $`bun ${CLI_PATH} task edit 2 --depends-on ${""} --plain`.cwd(testDir).quiet();
		expect(emptyDependsOn.exitCode).toBe(0);
		expect((await core.filesystem.loadTask("TASK-2"))?.dependencies).toEqual([]);

		await $`bun ${CLI_PATH} task edit 2 --depends-on TASK-1`.cwd(testDir).quiet();
		const emptyDep = await $`bun ${CLI_PATH} task edit 2 --dep ${""} --plain`.cwd(testDir).quiet();
		expect(emptyDep.exitCode).toBe(0);
		expect((await core.filesystem.loadTask("TASK-2"))?.dependencies).toEqual([]);
	});

	// Blank values normalize away exactly as they do inside one value (`--dep "TASK-1,"`) and for `-a ""`,
	// so a real dependency alongside a blank one still sets that dependency.
	it("ignores an empty value when a dependency value is also given", async () => {
		await $`bun ${CLI_PATH} task create "Base task"`.cwd(testDir).quiet();
		await $`bun ${CLI_PATH} task create "Dependent task"`.cwd(testDir).quiet();

		const result = await $`bun ${CLI_PATH} task edit 2 --depends-on ${""} --dep TASK-1 --plain`.cwd(testDir).quiet();

		expect(result.exitCode).toBe(0);
		expect((await core.filesystem.loadTask("TASK-2"))?.dependencies).toEqual(["TASK-1"]);
	});

	it("documents --clear-deps in task edit help", async () => {
		const result = await $`bun ${CLI_PATH} task edit --help`.cwd(testDir).quiet();

		expect(result.stdout.toString()).toContain("--clear-deps");
	});

	it("accepts an archived task as a dependency at create and edit time", async () => {
		await $`bun ${CLI_PATH} task create "Done predecessor" -s Done`.cwd(testDir).quiet();
		await $`bun ${CLI_PATH} task archive 1`.cwd(testDir).quiet();

		const created = await $`bun ${CLI_PATH} task create "Dependent task" --dep TASK-1`.cwd(testDir).quiet().nothrow();
		expect(created.exitCode).toBe(0);
		expect((await core.filesystem.loadTask("TASK-2"))?.dependencies).toEqual(["TASK-1"]);

		await $`bun ${CLI_PATH} task create "Other target"`.cwd(testDir).quiet();
		const edited = await $`bun ${CLI_PATH} task edit 2 --depends-on TASK-1,TASK-3`.cwd(testDir).quiet().nothrow();
		expect(edited.exitCode).toBe(0);
		expect((await core.filesystem.loadTask("TASK-2"))?.dependencies).toEqual(["TASK-1", "TASK-3"]);
	});

	it("rejects a dependency that does not exist", async () => {
		const result = await $`bun ${CLI_PATH} task create "Dependent task" --dep TASK-999`.cwd(testDir).quiet().nothrow();

		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("The following dependencies do not exist: TASK-999");
	});
});
