import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../index.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createUniqueTestDir, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const CLI_PATH = getTestCliPath();

let TEST_DIR: string;
let core: Core;

async function runCli(args: string[], cwd = TEST_DIR) {
	return await $`bun ${[CLI_PATH, ...args]}`.cwd(cwd).nothrow().quiet();
}

async function addTask(id: string, title: string, dependencies: string[] = []) {
	await core.createTask(
		{ id, title, status: "To Do", assignee: [], createdDate: "2026-07-14 09:30", labels: [], dependencies },
		false,
	);
}

/** The dependency-graph block of `task view --plain`, without the surrounding detail sections. */
function graphSection(stdout: string): string[] {
	const lines = stdout.split("\n");
	const start = lines.indexOf("Dependency Graph:");
	if (start === -1) return [];
	// Everything after the heading and its rule, up to whatever section comes next. The direction
	// headings carry counts in parentheses, so they never look like a top-level section heading.
	const body = lines.slice(start + 2);
	const next = body.findIndex((line) => /^[A-Z][A-Za-z ]+:$/.test(line));
	const section = next === -1 ? body : body.slice(0, next);
	while (section.length > 0 && section[section.length - 1] === "") section.pop();
	return section;
}

describe("CLI dependency graph", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-cli-dependency-graph");
		await mkdir(TEST_DIR, { recursive: true });
		core = new Core(TEST_DIR);
		await initializeFilesystemTestProject(core, "Dependency Graph Test");
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("shows complete forward and reverse chains with direct and transitive relationships", async () => {
		await addTask("task-1", "Foundation");
		await addTask("task-2", "Middle", ["task-1"]);
		await addTask("task-3", "Selected", ["task-2"]);
		await addTask("task-4", "Follow up", ["task-3"]);
		await addTask("task-5", "Last", ["task-4"]);

		const result = await runCli(["task", "view", "3", "--plain"]);
		expect(result.exitCode).toBe(0);
		expect(graphSection(result.stdout.toString())).toEqual([
			"Depends on (1 direct, 2 total):",
			"└─ TASK-2 - Middle [To Do]",
			"   └─ TASK-1 - Foundation [To Do]",
			"",
			"Dependents (1 direct, 2 total):",
			"└─ TASK-4 - Follow up [To Do]",
			"   └─ TASK-5 - Last [To Do]",
		]);
	});

	it("renders view, create, and edit through the one plain serializer", async () => {
		await addTask("task-1", "Foundation");
		await addTask("task-2", "Selected", ["task-1"]);

		// The registry renders the declared dependency field, and detail adds the graph.
		const viewed = (await runCli(["task", "view", "2", "--plain"])).stdout.toString();
		expect(viewed).toContain("Dependencies: task-1");
		expect(viewed).toContain("Dependency Graph:");
		expect(viewed.indexOf("Dependency Graph:")).toBeLessThan(viewed.indexOf("Description:"));

		// A write confirmation is the same serializer, so it renders the identical layout.
		const edited = (await runCli(["task", "edit", "2", "--plain", "-l", "graph"])).stdout.toString();
		expect(edited).toContain("Dependencies: task-1");
		expect(edited).toContain("Dependency Graph:");
		expect(edited).toContain("└─ TASK-1 - Foundation [To Do]");
		expect(edited.indexOf("Dependency Graph:")).toBeLessThan(edited.indexOf("Description:"));

		const created = (await runCli(["task", "create", "Third", "--dep", "task-1", "--plain"])).stdout.toString();
		expect(created).toContain("Dependency Graph:");
		expect(created).toContain("└─ TASK-1 - Foundation [To Do]");
	});

	it("keeps hidden modified files stored while rendering schema sections", async () => {
		await addTask("task-1", "Selected");
		await runCli(["task", "edit", "1", "--section", "description=Did the work", "--modified-file", "src/api.ts"]);

		const stdout = (await runCli(["task", "view", "1", "--plain"])).stdout.toString();
		expect(stdout).toContain("Description:");
		expect(stdout).toContain("Did the work");
		expect(stdout).not.toContain("Modified files:");
		expect((await new Core(TEST_DIR).filesystem.loadTask("task-1"))?.modifiedFiles).toEqual(["src/api.ts"]);
	});

	it("renders a diamond once and marks the repeated branch", async () => {
		await addTask("task-1", "Shared");
		await addTask("task-2", "Left", ["task-1"]);
		await addTask("task-3", "Right", ["task-1"]);
		await addTask("task-4", "Selected", ["task-2", "task-3"]);

		expect(graphSection((await runCli(["task", "view", "4", "--plain"])).stdout.toString())).toEqual([
			"Depends on (2 direct, 3 total):",
			"├─ TASK-2 - Left [To Do]",
			"│  └─ TASK-1 - Shared [To Do]",
			"└─ TASK-3 - Right [To Do]",
			"   └─ TASK-1 - Shared [To Do] (shown above)",
		]);
	});

	it("terminates a cycle instead of repeating it", async () => {
		// Validation refuses to create a cycle, so store one directly as the legacy defect
		// `backlog doctor` reports; the graph must still render it honestly.
		await addTask("task-1", "Selected", ["task-2"]);
		await addTask("task-2", "Second", ["task-1"]);

		const lines = graphSection((await runCli(["task", "view", "1", "--plain"])).stdout.toString());
		expect(lines).toEqual([
			"Depends on (1 direct, 1 total):",
			"└─ TASK-2 - Second [To Do]",
			"   └─ TASK-1 - Selected [To Do] (cycle)",
			"",
			"Dependents (1 direct, 1 total):",
			"└─ TASK-2 - Second [To Do]",
			"   └─ TASK-1 - Selected [To Do] (cycle)",
		]);
	});

	it("names an archived finished dependency as completed and keeps it resolved", async () => {
		await addTask("task-1", "Finished");
		await addTask("task-2", "Selected", ["task-1"]);
		expect((await runCli(["task", "edit", "1", "-s", "Done"])).exitCode).toBe(0);
		expect((await runCli(["task", "archive", "1"])).exitCode).toBe(0);

		expect(graphSection((await runCli(["task", "view", "2", "--plain"])).stdout.toString())).toEqual([
			"Depends on (1 direct, 1 total):",
			"└─ TASK-1 - Finished [completed]",
		]);
	});

	it("keeps an archived unfinished dependency resolved under its own status", async () => {
		await addTask("task-1", "Set aside");
		await addTask("task-2", "Selected", ["task-1"]);
		expect((await runCli(["task", "archive", "1"])).exitCode).toBe(0);

		expect(graphSection((await runCli(["task", "view", "2", "--plain"])).stdout.toString())).toEqual([
			"Depends on (1 direct, 1 total):",
			"└─ TASK-1 - Set aside [To Do]",
		]);
	});

	it("reports an unknown dependency reference explicitly", async () => {
		await addTask("task-1", "Selected", ["task-404"]);

		const stdout = (await runCli(["task", "view", "1", "--plain"])).stdout.toString();
		expect(graphSection(stdout)).toEqual(["Depends on (1 direct, 1 total):", "└─ task-404 - unknown task ID"]);

		const json = JSON.parse((await runCli(["task", "view", "1", "--json"])).stdout.toString());
		expect(json.schemaVersion).toBe(2);
		expect(json.task.fields.dependencies).toEqual(["task-404"]);
		expect(json.task.unknownFields).toEqual({});
	});

	it("reports an ambiguous dependency identity explicitly and never picks a record", async () => {
		await addTask("task-1", "Contested");
		await addTask("task-2", "Selected", ["task-1"]);
		const original = join(TEST_DIR, "backlog", "tasks", "task-1 - Contested.md");
		await writeFile(join(TEST_DIR, "backlog", "tasks", "task-01 - Contested-copy.md"), await readFile(original));

		const stdout = (await runCli(["task", "view", "2", "--plain"])).stdout.toString();
		expect(graphSection(stdout)).toEqual(["Depends on (1 direct, 1 total):", "└─ TASK-1 - ambiguous task ID"]);

		const json = JSON.parse((await runCli(["task", "view", "2", "--json"])).stdout.toString());
		expect(json.schemaVersion).toBe(2);
		expect(json.task.fields.dependencies).toEqual(["task-1"]);
		expect(json.task.unknownFields).toEqual({});
	});

	it("omits the section for a task with no dependencies and no dependents", async () => {
		await addTask("task-1", "Alone");
		expect((await runCli(["task", "view", "1", "--plain"])).stdout.toString()).not.toContain("Dependency Graph:");
	});

	it("publishes dependency fields in JSON version 2 without the old graph envelope", async () => {
		await addTask("task-1", "Foundation");
		await addTask("task-2", "Selected", ["task-1"]);
		await addTask("task-3", "Follow up", ["task-2"]);

		for (const args of [
			["task", "view", "2", "--json"],
			["task", "2", "--json"],
		]) {
			const output = JSON.parse((await runCli(args)).stdout.toString());
			expect(output.schemaVersion).toBe(2);
			expect(output.kind).toBe("task-view");
			expect(output.task.fields.dependencies).toEqual(["task-1"]);
			expect(output.task.unknownFields).toEqual({});
			expect(output.task.dependencyGraph).toBeUndefined();
		}
	});

	it("keeps the full graph out of compact payloads while including direct dependencies", async () => {
		await addTask("task-1", "Foundation");
		await addTask("task-2", "Selected", ["task-1"]);

		const list = JSON.parse((await runCli(["task", "list", "--json"])).stdout.toString());
		expect(list.dependencyGraph).toBeUndefined();
		for (const summary of list.tasks) {
			expect(Object.keys(summary)).not.toContain("dependencyGraph");
			expect(summary.fields.dependencies).toEqual(summary.id === "TASK-2" ? ["task-1"] : []);
		}

		const search = JSON.parse((await runCli(["search", "Selected", "--json"])).stdout.toString());
		expect(search.dependencyGraph).toBeUndefined();
		for (const entry of search.results) {
			expect(Object.keys(entry.data)).not.toContain("dependencyGraph");
			expect(entry.data.fields.dependencies).toEqual(["task-1"]);
		}

		// The plain edit confirmation uses the same full graph as task view.
		const edited = await runCli(["task", "edit", "2", "--plain", "-l", "graph"]);
		expect(edited.exitCode).toBe(0);
		expect(edited.stdout.toString()).toContain("Dependency Graph:");
	});

	it("keeps a wide and deep graph linear in the rendered output", async () => {
		for (let position = 1; position <= 60; position++) {
			await addTask(`task-${position}`, `Chain ${position}`, position === 1 ? [] : [`task-${position - 1}`]);
		}
		for (let position = 1; position <= 20; position++) {
			await addTask(`task-${100 + position}`, `Fan ${position}`, ["task-60"]);
		}

		const lines = graphSection((await runCli(["task", "view", "60", "--plain"])).stdout.toString());
		// 59 dependencies, 20 dependents, two headings, one blank separator: every node exactly once.
		expect(lines).toHaveLength(59 + 20 + 3);
		expect(lines[0]).toBe("Depends on (1 direct, 59 total):");
		expect(lines.find((line) => line.startsWith("Dependents"))).toBe("Dependents (20 direct, 20 total):");
	});
});
