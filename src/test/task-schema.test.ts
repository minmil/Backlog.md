import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	assertCoreRegistryMatchesSerializer,
	getDefaultTaskSchema,
	getDefaultTaskSchemaText,
	loadTaskSchema,
	parseTaskSchema,
} from "../schema/index.ts";
import { validateTaskFiles } from "../schema/validate-tasks.ts";

const temporaryDirectories: string[] = [];
afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function projectFiles(config = "project_name: Example\n"): string {
	const directory = mkdtempSync(join(tmpdir(), "backlog-schema-"));
	temporaryDirectories.push(directory);
	writeFileSync(join(directory, "task-schema.yml"), getDefaultTaskSchemaText());
	writeFileSync(join(directory, "config.yml"), config);
	return directory;
}

function altered(before: string, after: string): string {
	const source = getDefaultTaskSchemaText();
	expect(source).toContain(before);
	return source.replace(before, after);
}

describe("task schema", () => {
	test("shipped schemas parse and the core keys track the serializer", () => {
		assertCoreRegistryMatchesSerializer();
		const schema = getDefaultTaskSchema();
		expect(schema.fields.ordinal?.hidden).toBeUndefined();
		expect(schema.fields.project?.values).toEqual([]);
		const example = readFileSync(join(import.meta.dir, "../../docs/examples/operations-tracker-schema.yml"), "utf8");
		expect(parseTaskSchema(example).fields.tech_action?.track_changes).toBe(true);
	});

	test("core fields may retain attributes but cannot be removed", () => {
		expect(parseTaskSchema(altered("label: Assignee", "label: Owner")).fields.assignee?.label).toBe("Owner");
		expect(() =>
			parseTaskSchema(
				altered("  subtasks: {type: task-ref-list, core: true, managed: true, hidden: true, label: Subtasks}\n", ""),
			),
		).toThrow(/Missing core field/);
	});

	test("core field types are fixed", () => {
		expect(getDefaultTaskSchema().fields.status?.type).toBe("enum");
		expect(() => parseTaskSchema(altered("status: {type: enum", "status: {type: text"))).toThrow(
			/Core field type must be enum/,
		);
	});

	test("enum defaults must be allowed values", () => {
		expect(getDefaultTaskSchema().fields.status?.default).toBe("To Do");
		expect(() => parseTaskSchema(altered("default: To Do", "default: Blocked"))).toThrow(/fields.status.default/);
	});

	test("UI entries must name declared visible fields", () => {
		expect(getDefaultTaskSchema().ui.board.card).toContain("priority");
		expect(() => parseTaskSchema(altered("card: [type,", "card: [unknown,"))).toThrow(/Unknown field unknown/);
		expect(() => parseTaskSchema(altered("card: [type,", "card: [branch,"))).toThrow(/Hidden field branch/);
	});

	test("filters reject non-filterable types", () => {
		expect(getDefaultTaskSchema().ui.board.filters).toContain("priority");
		expect(() => parseTaskSchema(altered("filters: [assignee,", "filters: [title,"))).toThrow(/cannot be filtered/);
	});

	test("translations require declared compatible sources", () => {
		const valid = `${getDefaultTaskSchemaText()}\n`;
		expect(parseTaskSchema(valid).sections.description?.kind).toBe("markdown");
		expect(() =>
			parseTaskSchema(
				altered(
					"  description: {kind: markdown, title: Description}",
					"  description: {kind: markdown, title: Description, lang: ja, translation_of: missing}",
				),
			),
		).toThrow(/Expected another declared key/);
	});

	test("a nonempty users list has exactly one default", () => {
		expect(getDefaultTaskSchema().users).toEqual([]);
		expect(
			parseTaskSchema(altered("users: []", "users: [{handle: '@a', name: A, default: true}]")).users[0]?.handle,
		).toBe("@a");
		expect(() => parseTaskSchema(altered("users: []", "users: [{handle: '@a', name: A}]"))).toThrow(/Exactly one user/);
	});

	test("loader rejects moved config keys and old fields file", () => {
		const directory = projectFiles();
		expect(loadTaskSchema(directory).fields.title?.core).toBe(true);
		writeFileSync(join(directory, "config.yml"), "project_name: Example\nstatuses: [To Do]\n");
		expect(() => loadTaskSchema(directory)).toThrow(/Move this config.yml key/);
		writeFileSync(join(directory, "config.yml"), "project_name: Example\n");
		writeFileSync(join(directory, "fields.yml"), "fields: {}\n");
		expect(() => loadTaskSchema(directory)).toThrow(/Replace fields.yml/);
	});

	test("stored task validation reports broken references", () => {
		const directory = projectFiles();
		mkdirSync(join(directory, "tasks"));
		writeFileSync(
			join(directory, "tasks", "task-1.md"),
			"---\nid: task-1\ntitle: First\nstatus: To Do\ncreated_date: '2026-10-24T12:00:00Z'\n---\n",
		);
		expect(validateTaskFiles(directory, getDefaultTaskSchema())).toEqual([]);
		writeFileSync(
			join(directory, "tasks", "task-1.md"),
			"---\nid: task-1\ntitle: First\nstatus: To Do\ncreated_date: '2026-10-24T12:00:00Z'\ndependencies: [task-404]\n---\n",
		);
		expect(validateTaskFiles(directory, getDefaultTaskSchema()).map((issue) => issue.message)).toContain(
			"Task task-404 does not exist",
		);
		writeFileSync(
			join(directory, "tasks", "task-1.md"),
			"---\nid: task-1\ntitle: First\nstatus: To Do\ncreated_date: '2026-10-24T12:00:00Z'\ndependencies: [task-2]\n---\n",
		);
		writeFileSync(
			join(directory, "tasks", "task-2.md"),
			"---\nid: task-2\ntitle: Second\nstatus: To Do\ncreated_date: '2026-10-24T12:00:00Z'\ndependencies: [task-1]\n---\n",
		);
		expect(validateTaskFiles(directory, getDefaultTaskSchema()).some((issue) => issue.message.includes("cycle"))).toBe(
			true,
		);
	});
});
