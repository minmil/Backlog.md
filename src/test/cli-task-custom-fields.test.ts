import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createUniqueTestDir, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

const CLI_PATH = getTestCliPath();
let root: string;
let core: Core;

function run(args: string[], env: Record<string, string | undefined> = process.env) {
	const result = Bun.spawnSync({ cmd: [process.execPath, CLI_PATH, ...args], cwd: root, env });
	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
	};
}

beforeEach(async () => {
	root = createUniqueTestDir("test-cli-task-custom-fields");
	await mkdir(root, { recursive: true });
	core = new Core(root);
	await initializeFilesystemTestProject(core, "Custom field CLI");
	await Bun.write(
		join(core.filesystem.backlogDir, "fields.yml"),
		[
			"fields:",
			"  client_facing:",
			"    type: bool",
			"    default: false",
			"  tech_action:",
			"    type: enum",
			"    values: [Pending Triage, Configuring, Testing]",
			"  prod_date:",
			"    type: date",
			"  title_ja:",
			"    type: text",
			"",
		].join("\n"),
	);
});

afterEach(async () => {
	await safeCleanup(root);
});

describe("CLI task custom fields", () => {
	it("prints the schema and writes canonical values through create and edit", async () => {
		const fields = JSON.parse(run(["fields", "--json"]).stdout);
		expect(fields.kind).toBe("fields");
		expect(fields.fields.map((field: { name: string }) => field.name)).toEqual([
			"client_facing",
			"tech_action",
			"prod_date",
			"title_ja",
		]);

		const created = run([
			"task",
			"create",
			"Sample",
			"--field",
			"tech_action=testing",
			"--field",
			"prod_date=2026-10-23",
			"--field",
			"title_ja=Japanese=title",
			"--plain",
		]);
		expect(created.exitCode).toBe(0);
		expect(created.stdout).toContain("tech_action: Testing");
		expect(created.stdout).toContain("title_ja: Japanese=title");
		expect((await core.filesystem.loadTask("TASK-1"))?.customFields?.client_facing).toBe(false);

		const edited = run(["task", "edit", "TASK-1", "--field", "tech_action=configuring", "--plain"]);
		expect(edited.stdout).toContain("tech_action: Configuring");
		const viewed = JSON.parse(run(["task", "view", "TASK-1", "--json"]).stdout);
		expect(viewed.task.customFields).toEqual({
			client_facing: false,
			tech_action: "Configuring",
			prod_date: "2026-10-23",
			title_ja: "Japanese=title",
		});

		expect(run(["task", "edit", "TASK-1", "--clear-field", "prod_date"]).exitCode).toBe(0);
		expect((await core.filesystem.loadTask("TASK-1"))?.customFields?.prod_date).toBeUndefined();
	});

	it("rejects invalid values and set/clear conflicts without changing the file", async () => {
		expect(run(["task", "create", "Sample", "--field", "tech_action=Testing"]).exitCode).toBe(0);
		const path = (await core.filesystem.loadTask("TASK-1"))?.filePath as string;
		const before = await Bun.file(path).text();
		for (const args of [
			["task", "edit", "TASK-1", "--field", "tech_action=Nonsense"],
			["task", "edit", "TASK-1", "--field", "outside=value"],
			["task", "edit", "TASK-1", "--field", "tech_action=Testing", "--clear-field", "tech_action"],
		]) {
			const result = run(args);
			expect(result.exitCode).toBe(1);
			expect(await Bun.file(path).text()).toBe(before);
		}
	});

	it("filters with built-ins, sorts dates, and shows selected fields", () => {
		expect(
			run([
				"task",
				"create",
				"First",
				"--status",
				"In Progress",
				"--field",
				"tech_action=Testing",
				"--field",
				"prod_date=2026-10-24",
				"--field",
				"client_facing=yes",
			]).exitCode,
		).toBe(0);
		expect(
			run([
				"task",
				"create",
				"Second",
				"--status",
				"In Progress",
				"--field",
				"tech_action=Testing",
				"--field",
				"prod_date=2026-10-23",
			]).exitCode,
		).toBe(0);
		expect(run(["task", "create", "Third", "--field", "tech_action=Configuring"]).exitCode).toBe(0);

		const list = JSON.parse(
			run(["task", "list", "-s", "In Progress", "--where", "tech_action=testing", "--sort", "prod_date", "--json"])
				.stdout,
		);
		expect(list.tasks.map((task: { id: string }) => task.id)).toEqual(["TASK-2", "TASK-1"]);

		const plain = run([
			"task",
			"list",
			"--where",
			"client_facing=yes",
			"--plain",
			"--show-fields",
			"tech_action,client_facing",
		]);
		expect(plain.stdout).toContain("TASK-1 - First tech_action=Testing client_facing=true");
		expect(plain.stdout).not.toContain("TASK-2");
		const invalid = run(["task", "list", "--where", "status!=Done", "--plain"]);
		expect(invalid.exitCode).toBe(1);
		expect(invalid.stderr).toContain("--where is for custom fields only");
	});

	it("uses fixed local relative dates and preserves empty JSON fields", () => {
		expect(run(["task", "create", "Tomorrow", "--field", "prod_date=2026-10-23"]).exitCode).toBe(0);
		expect(run(["task", "create", "Bare"]).exitCode).toBe(0);
		const filtered = JSON.parse(
			run(["task", "list", "--where", "prod_date>=today", "--where", "prod_date<=+7d", "--json"], {
				...process.env,
				BACKLOG_CUSTOM_FIELDS_TODAY: "2026-10-22",
			}).stdout,
		);
		expect(filtered.tasks.map((task: { id: string }) => task.id)).toEqual(["TASK-1"]);
		const all = JSON.parse(run(["task", "list", "--json"]).stdout);
		expect(all.tasks[1].customFields).toEqual({ client_facing: false });
	});
});
