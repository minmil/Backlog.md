import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { FieldRegistry } from "../schema/field-registry.ts";
import { getDefaultTaskSchemaText, parseTaskSchema } from "../schema/index.ts";
import { validateTaskFiles } from "../schema/validate-tasks.ts";
import { getTestCliPath } from "./test-cli.ts";
import { initializeFilesystemTestProject, updateTestTaskSchema } from "./test-utils.ts";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function project() {
	const directory = mkdtempSync(join(tmpdir(), "backlog-sequence-"));
	directories.push(directory);
	const core = new Core(directory);
	await initializeFilesystemTestProject(core, "Sequence");
	await updateTestTaskSchema(core.filesystem, (schema) => {
		schema.fields.project = { ...schema.fields.project!, values: ["Client 1", "Client 2"] };
		schema.fields.client_facing = { type: "bool", default: true };
		schema.fields.client_ref = {
			type: "sequence",
			scope: "project",
			prefixes: { "Client 1": "C1", "Client 2": "C2" },
			pad: 3,
			assign_when: { client_facing: true },
		};
	});
	return { directory, core, registry: new FieldRegistry(core.filesystem.taskSchema) };
}

test("sequence schema checks scope, prefixes, padding and conditions", () => {
	const source = getDefaultTaskSchemaText()
		.replace(
			"\nsections:",
			`\n  client_ref:\n    type: sequence\n    scope: project\n    prefixes: {Client 1: C1, 'Client 2': C2}\n    pad: 3\n    assign_when: {client_facing: true}\n  client_facing: {type: bool}\nsections:`,
		)
		.replace(
			"project: {type: enum, core: true, values: [], hidden: true, label: Project}",
			"project: {type: enum, core: true, values: [Client 1, 'Client 2'], hidden: true, label: Project}",
		);
	const schema = parseTaskSchema(source);
	expect(schema.fields.client_ref?.type).toBe("sequence");
	expect(() => parseTaskSchema(source.replace("scope: project", "scope: title"))).toThrow(/scope/);
	expect(() => parseTaskSchema(source.replace("'Client 2': C2", "'Client 2': C1"))).toThrow(/unique/);
	expect(() => parseTaskSchema(source.replace("pad: 3", "pad: 7"))).toThrow(/Padding/);
	expect(() => parseTaskSchema(source.replace("client_facing: true", "client_facing: bad"))).toThrow(
		/Invalid condition value/,
	);
});

test("sequence assigns by scope, preserves references, and includes archived maxima", async () => {
	const { core, registry } = await project();
	const create = (title: string, project: string, clientFacing = true) =>
		core.createTaskFromInput({ title, project, fieldValues: { client_facing: clientFacing } }, false);
	const first = (await create("First", "Client 1")).task;
	expect(registry.getField(first, "client_ref")).toBe("C1-001");
	await core.archiveTask(first.id, false);
	const second = (await create("Second", "Client 1")).task;
	expect(registry.getField(second, "client_ref")).toBe("C1-002");
	expect(registry.getField((await create("Other", "Client 2")).task, "client_ref")).toBe("C2-001");
	const internal = (await create("Internal", "Client 1", false)).task;
	expect(registry.getField(internal, "client_ref")).toBeUndefined();
	const flipped = await core.updateTaskFromInput(internal.id, { schemaFields: { client_facing: true } }, false);
	expect(registry.getField(flipped, "client_ref")).toBe("C1-003");
	const changedScope = await core.updateTaskFromInput(second.id, { project: "Client 2" }, false);
	expect(registry.getField(changedScope, "client_ref")).toBe("C1-002");
	expect(
		validateTaskFiles(core.filesystem.backlogDir, core.filesystem.taskSchema).some(
			(issue) => issue.severity === "warning" && issue.message.includes("prefix"),
		),
	).toBe(true);
});

test("drafts wait for promotion and manual references cannot duplicate, mismatch or clear", async () => {
	const { core, registry } = await project();
	const draft = (await core.createTaskFromInput({ title: "Draft", status: "Draft", project: "Client 1" }, false)).task;
	expect(registry.getField(draft, "client_ref")).toBeUndefined();
	expect(await core.promoteDraft(draft.id, false)).toBe(true);
	const [promoted] = await core.filesystem.listTasks();
	expect(registry.getField(promoted!, "client_ref")).toBe("C1-001");
	await expect(
		core.createTaskFromInput({ title: "Wrong", project: "Client 1", fieldValues: { client_ref: "C2-002" } }, false),
	).rejects.toThrow(/prefix/);
	await expect(
		core.createTaskFromInput({ title: "Duplicate", project: "Client 1", fieldValues: { client_ref: "C1-001" } }, false),
	).rejects.toThrow(/already used/);
	const manual = (
		await core.createTaskFromInput(
			{ title: "Import", project: "Client 1", fieldValues: { client_ref: "C1-015" } },
			false,
		)
	).task;
	expect(registry.getField(manual, "client_ref")).toBe("C1-015");
	expect(
		registry.getField(
			(await core.createTaskFromInput({ title: "Next", project: "Client 1" }, false)).task,
			"client_ref",
		),
	).toBe("C1-016");
	await expect(core.updateTaskFromInput(manual.id, { clearSchemaFields: ["client_ref"] }, false)).rejects.toThrow(
		/permanent reference/,
	);
	await expect(core.updateTaskFromInput(manual.id, { schemaFields: { client_ref: "C1-020" } }, false)).rejects.toThrow(
		/permanent reference/,
	);
});

test("concurrent creates allocate unique numbers and sort numerically", async () => {
	const { core, registry } = await project();
	const records = await Promise.all(
		Array.from({ length: 5 }, (_, index) =>
			core.createTaskFromInput({ title: `Concurrent ${index}`, project: "Client 1" }, false),
		),
	);
	expect(records.map(({ task }) => registry.getField(task, "client_ref")).sort()).toEqual([
		"C1-001",
		"C1-002",
		"C1-003",
		"C1-004",
		"C1-005",
	]);
	expect(registry.compare("client_ref", "C1-009", "C1-010")).toBeLessThan(0);
	expect(registry.compare("client_ref", "C1-010", "C1-1000")).toBeLessThan(0);
});

test("CLI filters and sorts sequence references through the registry", async () => {
	const { directory, core } = await project();
	await core.createTaskFromInput({ title: "Ninth", project: "Client 1", fieldValues: { client_ref: "C1-009" } }, false);
	await core.createTaskFromInput({ title: "Tenth", project: "Client 1", fieldValues: { client_ref: "C1-010" } }, false);
	await core.createTaskFromInput(
		{ title: "Thousandth", project: "Client 1", fieldValues: { client_ref: "C1-1000" } },
		false,
	);
	const run = (args: string[]) =>
		Bun.spawnSync({
			cmd: [process.execPath, getTestCliPath(), ...args],
			cwd: directory,
			env: { ...process.env, BACKLOG_CWD: directory, CI: "true", TERM: "dumb" },
		});
	const listed = run(["task", "list", "--sort", "client_ref", "--where", "project=Client 1", "--json"]);
	expect(listed.exitCode, listed.stderr.toString()).toBe(0);
	expect(
		JSON.parse(listed.stdout.toString()).tasks.map(
			(task: { fields: { client_ref: string } }) => task.fields.client_ref,
		),
	).toEqual(["C1-009", "C1-010", "C1-1000"]);
	const filtered = run(["task", "list", "--where", "client_ref=C1-010", "--json"]);
	expect(filtered.exitCode, filtered.stderr.toString()).toBe(0);
	expect(JSON.parse(filtered.stdout.toString()).tasks.map((task: { title: string }) => task.title)).toEqual(["Tenth"]);
});

test("schema validation detects duplicates and malformed references in archived tasks", async () => {
	const { core } = await project();
	const first = (await core.createTaskFromInput({ title: "First", project: "Client 1" }, false)).task;
	const second = (await core.createTaskFromInput({ title: "Second", project: "Client 1" }, false)).task;
	await core.archiveTask(first.id, false);
	const archived = (await core.filesystem.listArchivedTasks()).find((task) => task.id === first.id);
	if (!archived?.filePath || !second.filePath) throw new Error("Expected task files");
	writeFileSync(
		second.filePath,
		readFileSync(second.filePath, "utf8").replace("client_ref: C1-002", "client_ref: C1-001"),
	);
	expect(
		validateTaskFiles(core.filesystem.backlogDir, core.filesystem.taskSchema).some((issue) =>
			issue.message.includes("Duplicate sequence reference"),
		),
	).toBe(true);
	writeFileSync(
		archived.filePath,
		readFileSync(archived.filePath, "utf8").replace("client_ref: C1-001", "client_ref: BAD"),
	);
	expect(
		validateTaskFiles(core.filesystem.backlogDir, core.filesystem.taskSchema).some((issue) =>
			issue.message.includes("Malformed sequence reference"),
		),
	).toBe(true);
});
