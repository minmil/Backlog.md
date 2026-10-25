import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { FileSystem } from "../file-system/operations.ts";
import { taskListJson } from "../formatters/json-output.ts";
import { parseTask } from "../markdown/parser.ts";
import { serializeTask } from "../markdown/serializer.ts";
import { FieldRegistry, type FieldValue } from "../schema/field-registry.ts";
import { getDefaultTaskSchemaText, parseTaskSchema } from "../schema/index.ts";
import type { Task } from "../types/index.ts";

const extraFields = `  note: {type: text}
  release_item: {type: bool}
  uat_date: {type: date}
  meeting: {type: datetime}
  side: {type: enum, values: [Buyer, Seller]}
  teams: {type: multi-enum, values: [Data, Infra]}
  tags: {type: string-list}
  owner: {type: user}
  watchers: {type: user-list}
  parent_ref: {type: task-ref}
  related: {type: task-ref-list}
  release_ref: {type: milestone-ref}
  rank: {type: number}
`;
const temporaryDirectories: string[] = [];
afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function registry(): FieldRegistry {
	const source = getDefaultTaskSchemaText()
		.replace("users: []", "users: [{handle: '@a', name: A, default: true}]")
		.replace("\nsections:", `\n${extraFields}\nsections:`);
	return new FieldRegistry(parseTaskSchema(source), {
		taskIds: new Set(["task-1", "task-2"]),
		milestoneIds: new Set(["m-1"]),
	});
}

function task(): Task {
	return {
		id: "task-1",
		title: "First",
		status: "To Do",
		assignee: [],
		createdDate: "2026-10-24T00:00:00Z",
		labels: [],
		dependencies: [],
	};
}

describe("field registry", () => {
	test("reads and updates core and custom fields through the same API", () => {
		const fields = registry();
		const original = task();
		const changed = fields.setField(fields.setField(original, "status", "done"), "side", "seller");
		expect(fields.getField(original, "status")).toBe("To Do");
		expect(fields.getField(changed, "status")).toBe("Done");
		expect(fields.getField(changed, "side")).toBe("Seller");
		expect(changed.fieldValues?.side).toBe("Seller");
		expect(fields.getField(fields.clearField(changed, "side"), "side")).toBeUndefined();
		expect(
			fields.getField(fields.clearField(fields.setField(changed, "labels", ["urgent"]), "labels"), "labels"),
		).toEqual([]);
		expect(() => fields.clearField(changed, "status")).toThrow(/cannot be cleared/);
		expect(() => fields.setField(changed, "title", "")).toThrow(/required/);
		expect(() => fields.setField(changed, "created_date", "2026-10-24 12:00")).toThrow(/managed/);
	});

	test("parses and validates every supported field type", () => {
		const fields = registry();
		const cases: Array<[string, string, FieldValue]> = [
			["note", "hello", "hello"],
			["release_item", "yes", true],
			["uat_date", "2026-11-01", "2026-11-01"],
			["meeting", "2026-11-01 12:45", "2026-11-01 12:45"],
			["side", "buyer", "Buyer"],
			["teams", "infra,data", ["Infra", "Data"]],
			["tags", "a,b", ["a", "b"]],
			["owner", "@a", "@a"],
			["watchers", "@a", ["@a"]],
			["parent_ref", "task-2", "task-2"],
			["related", "task-2", ["task-2"]],
			["release_ref", "m-1", "m-1"],
			["rank", "42", 42],
		];
		let current = task();
		for (const [key, raw, expected] of cases) {
			current = fields.setField(current, key, fields.parseInput(key, raw));
			expect(fields.getField(current, key)).toEqual(expected);
		}
		expect(fields.parseInput("id", "task-2")).toBe("task-2");
		expect(() => fields.parseInput("side", "unknown")).toThrow(/allowed values/);
		expect(() => fields.parseInput("owner", "@unknown")).toThrow(/configured/);
		expect(() => fields.parseInput("parent_ref", "task-404")).toThrow(/does not exist/);
		expect(() => fields.parseInput("uat_date", "2026-02-30")).toThrow(/YYYY-MM-DD/);
	});

	test("conditions and sorting use schema types and enum order", () => {
		const fields = registry();
		const current = fields.setField(fields.setField(task(), "status", "Done"), "uat_date", "2026-10-25");
		expect(fields.matches(current, fields.parseCondition("status=done"))).toBe(true);
		expect(fields.matches(current, fields.parseCondition("uat_date>=today", new Date(2026, 9, 24, 12)))).toBe(true);
		expect(fields.matches(current, fields.parseCondition("side="))).toBe(true);
		expect(() => fields.parseCondition("title=First")).toThrow(/cannot be filtered/);
		expect(fields.compare("status", "To Do", "Done")).toBeLessThan(0);
		expect(fields.compare("rank", 2, 10)).toBeLessThan(0);
		expect(fields.compare("rank", undefined, 10)).toBeGreaterThan(0);
		expect(fields.format("tags", ["a", "b"], "plain")).toBe("a, b");
		expect(fields.format("tags", ["a", "b"], "json")).toEqual(["a", "b"]);
	});

	test("overdue date boundaries and conditions use the local day", () => {
		const schema = parseTaskSchema(
			getDefaultTaskSchemaText()
				.replace(
					"due_date: {type: date, core: true, label: Due}",
					"due_date: {type: date, core: true, label: Due, overdue_when: {status: [To Do, In Progress], assignee: ['@a']}}",
				)
				.replace("users: []", "users: [{handle: '@a', name: A, default: true}]")
				.replace("\nsections:", "\n  client_due: {type: date, overdue_when: {status: To Do}}\nsections:"),
		);
		const fields = new FieldRegistry(schema);
		const today = new Date(2026, 9, 25, 12);
		const base = fields.setField({ ...task(), assignee: ["@a"] }, "due_date", "2026-10-24");
		expect(fields.isOverdue(base, "due_date", today)).toBe(true);
		expect(fields.overdueFields(base, today)).toEqual(["due_date"]);
		expect(fields.isOverdue(fields.setField(base, "due_date", "2026-10-25"), "due_date", today)).toBe(false);
		expect(fields.isOverdue(fields.setField(base, "due_date", "2026-10-26"), "due_date", today)).toBe(false);
		expect(fields.isOverdue(fields.clearField(base, "due_date"), "due_date", today)).toBe(false);
		expect(fields.isOverdue({ ...base, assignee: [] }, "due_date", today)).toBe(false);
		expect(fields.isOverdue({ ...base, status: "Done" }, "due_date", today)).toBe(false);
		expect(fields.overdueFields(fields.setField(base, "client_due", "2026-10-20"), today)).toEqual([
			"due_date",
			"client_due",
		]);
	});

	test("schema rejects invalid overdue rules", () => {
		const source = getDefaultTaskSchemaText();
		const withRule = (definition: string) =>
			source.replace("due_date: {type: date, core: true, label: Due}", definition);
		expect(() => parseTaskSchema(withRule("due_date: {type: date, core: true, overdue_when: {title: X}}"))).toThrow(
			/Condition field/,
		);
		expect(() =>
			parseTaskSchema(withRule("due_date: {type: date, core: true, overdue_when: {status: Unknown}}")),
		).toThrow(/Invalid condition value/);
		expect(() =>
			parseTaskSchema(
				source.replace(
					"title: {type: text, core: true, required: true, label: Title}",
					"title: {type: text, core: true, required: true, overdue_when: {status: To Do}}",
				),
			),
		).toThrow(/Only date fields/);
	});

	test("task-list JSON v2 uses the canonical fields object", () => {
		const fields = registry();
		const item = { ...fields.setField(task(), "side", "Buyer"), unknownFields: { legacy: "keep" }, isReady: true };
		const json = taskListJson([item], undefined, fields);
		expect(json.schemaVersion).toBe(2);
		expect(json.tasks[0]).toEqual({
			id: "task-1",
			title: "First",
			fields: {
				id: "task-1",
				title: "First",
				status: "To Do",
				assignee: [],
				created_date: "2026-10-24T00:00:00Z",
				labels: [],
				dependencies: [],
				side: "Buyer",
			},
			unknownFields: { legacy: "keep" },
			overdue: [],
		});
	});

	test("declared custom values round-trip while unknown frontmatter survives", () => {
		const fields = registry();
		const source =
			"---\nid: task-1\ntitle: First\nstatus: To Do\nassignee: []\ncreated_date: '2026-10-24T00:00:00Z'\nlabels: []\ndependencies: []\nside: Buyer\ntags: [a, b]\nunknown_flag: keep\n---\n\n## Description\n\nBody\n";
		const parsed = parseTask(source, undefined, fields.schema);
		expect(fields.getField(parsed, "side")).toBe("Buyer");
		expect(fields.getField(parsed, "tags")).toEqual(["a", "b"]);
		expect(parsed.unknownFields?.unknown_flag).toBe("keep");
		const changed = fields.setField(parsed, "side", "seller");
		const serialized = serializeTask(changed, source, undefined, fields.schema);
		expect(serialized).toContain("unknown_flag: keep");
		expect(fields.getField(parseTask(serialized, undefined, fields.schema), "side")).toBe("Seller");
		const cleared = serializeTask(fields.clearField(changed, "side"), source, undefined, fields.schema);
		expect(cleared).not.toContain("side:");
		expect(cleared).toContain("unknown_flag: keep");
	});

	test("filesystem task storage reads and writes schema fields", async () => {
		const directory = mkdtempSync(join(tmpdir(), "backlog-registry-"));
		temporaryDirectories.push(directory);
		const backlogDir = join(directory, "backlog");
		mkdirSync(backlogDir);
		writeFileSync(join(backlogDir, "config.yml"), "project_name: Registry\ntask_prefix: task\n");
		writeFileSync(
			join(backlogDir, "task-schema.yml"),
			getDefaultTaskSchemaText().replace("\nsections:", `\n${extraFields}\nsections:`),
		);
		const filesystem = new FileSystem(directory);
		await filesystem.ensureBacklogStructure();
		const fields = new FieldRegistry(filesystem.taskSchema as NonNullable<typeof filesystem.taskSchema>);
		const prepared = fields.setField(task(), "teams", ["Data", "Infra"]);
		await filesystem.saveTask(prepared);
		const loaded = await filesystem.loadTask("task-1");
		expect(loaded).not.toBeNull();
		expect(fields.getField(loaded as Task, "teams")).toEqual(["Data", "Infra"]);
	});

	test("core create applies schema defaults and rejects invalid values before writing", async () => {
		const directory = mkdtempSync(join(tmpdir(), "backlog-registry-create-"));
		temporaryDirectories.push(directory);
		const backlogDir = join(directory, "backlog");
		mkdirSync(backlogDir);
		writeFileSync(join(backlogDir, "config.yml"), "project_name: Registry\ntask_prefix: task\nfilesystem_only: true\n");
		writeFileSync(
			join(backlogDir, "task-schema.yml"),
			getDefaultTaskSchemaText().replace(
				"\nsections:",
				"\n  side: {type: enum, values: [Buyer, Seller], default: Buyer}\n\nsections:",
			),
		);
		const core = new Core(directory);
		const created = await core.createTaskFromInput({ title: "First" });
		expect(created.task.fieldValues?.side).toBe("Buyer");
		await expect(core.createTaskFromInput({ title: "Rejected", fieldValues: { side: "Neither" } })).rejects.toThrow(
			/allowed values/,
		);
		expect((await core.filesystem.listTasks()).map((entry) => entry.title)).toEqual(["First"]);
	});

	test("schema edits keep unrelated file lines and reject invalid writes", async () => {
		const directory = mkdtempSync(join(tmpdir(), "backlog-registry-edit-"));
		temporaryDirectories.push(directory);
		const backlogDir = join(directory, "backlog");
		mkdirSync(backlogDir);
		writeFileSync(join(backlogDir, "config.yml"), "project_name: Registry\ntask_prefix: task\nfilesystem_only: true\n");
		writeFileSync(
			join(backlogDir, "task-schema.yml"),
			getDefaultTaskSchemaText().replace(
				"\nsections:",
				"\n  side: {type: enum, values: [Buyer, Seller]}\n  teams: {type: multi-enum, values: [Data, Infra]}\n\nsections:",
			),
		);
		const core = new Core(directory);
		const created = await core.createTaskFromInput({ title: "First", fieldValues: { side: "Buyer", teams: ["Data"] } });
		if (!created.filePath) throw new Error("Created task has no file path");
		const file = created.filePath;
		const before = readFileSync(file, "utf8");
		await core.updateTaskFromInput(created.task.id, { schemaFields: { status: "Done" } });
		const statusOnly = readFileSync(file, "utf8");
		const withoutVolatileLines = (source: string) =>
			source.replace(/^status:.*\n/gm, "").replace(/^updated_date:.*\n/gm, "");
		expect(withoutVolatileLines(statusOnly)).toBe(withoutVolatileLines(before));
		expect(statusOnly).toContain("status: Done");
		await core.updateTaskFromInput(created.task.id, {
			schemaFields: { side: "Seller" },
			addSchemaFields: { teams: ["Infra"] },
			removeSchemaFields: { teams: ["Data"] },
		});
		const edited = await core.filesystem.loadTask(created.task.id);
		expect(edited?.fieldValues).toMatchObject({ side: "Seller", teams: ["Infra"] });
		const unchanged = readFileSync(file, "utf8");
		await expect(core.updateTaskFromInput(created.task.id, { schemaFields: { side: "Other" } })).rejects.toThrow(
			/allowed values/,
		);
		expect(readFileSync(file, "utf8")).toBe(unchanged);
		const second = await core.createTaskFromInput({ title: "Second", fieldValues: { side: "Buyer" } });
		if (!second.filePath) throw new Error("Created task has no file path");
		expect(readFileSync(second.filePath, "utf8")).not.toContain("updated_date:");
		await core.updateTaskFromInput(second.task.id, { schemaFields: { side: "Seller" } });
		expect(readFileSync(second.filePath, "utf8")).toContain("updated_date:");
	});
});
