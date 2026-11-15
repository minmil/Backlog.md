import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { getTaskStatistics } from "../core/statistics.ts";
import { parseTask } from "../markdown/parser.ts";
import { serializeTask } from "../markdown/serializer.ts";
import { getDefaultTaskSchemaText, parseTaskSchema } from "../schema/index.ts";
import type { Task } from "../types/index.ts";
import { applyStatusOutcome } from "../utils/status-outcome.ts";
import { detailFieldOrder } from "../web/components/schema/SchemaSidebar.tsx";

const configured = getDefaultTaskSchemaText()
	.replace("users: []", 'users:\n  - {handle: "@Tester", name: Tester, default: true}')
	.replace(
		"  status: {type: enum, core: true, required: true, values: [To Do, In Progress, Done], default: To Do}",
		"  status: {type: enum, core: true, required: true, values: [To Do, In Progress, Closed], default: To Do, outcomes: [Done, Deferred, No longer needed], outcome_date: true, outcome_clears: [tech_action]}\n  tech_action: {type: enum, label: Tech action, values: [Investigating, Testing], track_changes: true}",
	);
const schema = parseTaskSchema(configured);
const makeTask = (status: string): Task => ({
	id: "TASK-1",
	title: "One",
	status,
	assignee: [],
	labels: [],
	dependencies: [],
	createdDate: "2026-11-01",
	fieldValues: {},
});

describe("status outcomes", () => {
	test("schema exposes outcomes beside status and rejects unsupported declarations", () => {
		expect(schema.fields.status?.outcomes).toEqual(["Done", "Deferred", "No longer needed"]);
		expect(schema.fields.outcome?.values).toEqual(schema.fields.status?.outcomes);
		expect(schema.fields.outcome_date?.managed).toBe(true);
		expect(schema.fields.status?.outcome_clears).toEqual(["tech_action"]);
		expect(schema.ui.detail.order).toEqual([]);
		expect(detailFieldOrder(schema).slice(0, 5)).toEqual(["title", "status", "outcome", "outcome_date", "tech_action"]);
		expect(() =>
			parseTaskSchema(
				configured.replace(
					"outcomes: [Done, Deferred, No longer needed], outcome_date: true, outcome_clears: [tech_action]}",
					"outcomes: [Done, done], outcome_date: true, outcome_clears: [tech_action]}",
				),
			),
		).toThrow(/Outcomes must be unique/);
		expect(() => parseTaskSchema(configured.replaceAll("outcome_date: true,", "outcome_date: maybe,"))).toThrow(
			/outcome_date/,
		);
		expect(() => parseTaskSchema(configured.replaceAll("[tech_action]", "[missing_field]"))).toThrow(/Unknown field/);
		expect(() => parseTaskSchema(configured.replaceAll("[tech_action]", "[status]"))).toThrow(/cannot be cleared/);
		expect(() => parseTaskSchema(configured.replaceAll("[tech_action]", "[id]"))).toThrow(/cannot be cleared/);
		expect(() => parseTaskSchema(configured.replaceAll("[tech_action]", "[tech_action, tech_action]"))).toThrow(
			/unique/,
		);
	});

	test("closing defaults to Done, stamps the date, and round trips through Markdown", () => {
		const task = makeTask("Closed");
		applyStatusOutcome(task, makeTask("In Progress"), schema, "2026-11-15");
		expect(task.fieldValues).toMatchObject({ outcome: "Done", outcome_date: "2026-11-15" });
		const parsed = parseTask(serializeTask(task, "", undefined, schema), undefined, schema);
		expect(parsed.fieldValues).toMatchObject({ outcome: "Done", outcome_date: "2026-11-15" });
	});

	test("explicit alternatives preserve the date until reopening", () => {
		const task = makeTask("Closed");
		task.fieldValues = { outcome: "Deferred" };
		applyStatusOutcome(task, makeTask("In Progress"), schema, "2026-11-15");
		expect(task.fieldValues).toEqual({ outcome: "Deferred", outcome_date: "2026-11-15" });
		task.fieldValues.outcome = "No longer needed";
		applyStatusOutcome(task, makeTask("Closed"), schema, "2026-11-16");
		expect(task.fieldValues.outcome_date).toBe("2026-11-15");
		task.status = "In Progress";
		applyStatusOutcome(task, makeTask("Closed"), schema, "2026-11-17");
		expect(task.fieldValues).toEqual({});
	});

	test("closing clears configured fields only on entry to Closed", () => {
		const task = makeTask("Closed");
		task.fieldValues = { tech_action: "Investigating" };
		applyStatusOutcome(task, makeTask("In Progress"), schema, "2026-11-15");
		expect(task.fieldValues).toEqual({ outcome: "Done", outcome_date: "2026-11-15" });
		task.fieldValues.tech_action = "Testing";
		applyStatusOutcome(task, { ...makeTask("Closed"), fieldValues: { outcome: "Done" } }, schema, "2026-11-16");
		expect(task.fieldValues.tech_action).toBe("Testing");
	});

	test("outcome_clears also supports optional core fields", () => {
		const coreSchema = parseTaskSchema(configured.replaceAll("[tech_action]", "[due_date]"));
		const task = { ...makeTask("Closed"), dueDate: "2026-11-30" };
		applyStatusOutcome(task, makeTask("In Progress"), coreSchema, "2026-11-15");
		expect(task.dueDate).toBeUndefined();
	});

	test("statistics count Done while retaining all outcomes in Closed", () => {
		const done = makeTask("Closed");
		done.fieldValues = { outcome: "Done" };
		const deferred = { ...makeTask("Closed"), id: "TASK-2", fieldValues: { outcome: "Deferred" } };
		const obsolete = { ...makeTask("Closed"), id: "TASK-3", fieldValues: { outcome: "No longer needed" } };
		const result = getTaskStatistics(
			[done, deferred, obsolete],
			[],
			["To Do", "In Progress", "Closed"],
			[],
			[done, deferred, obsolete],
			schema.fields.status?.outcomes,
		);
		expect(result.statusCounts.get("Closed")).toBe(3);
		expect(result.completedTasks).toBe(1);
	});

	test("core edits persist and clear outcomes across a status transition", async () => {
		const root = mkdtempSync(join(tmpdir(), "backlog-outcome-"));
		try {
			mkdirSync(join(root, "backlog"));
			writeFileSync(
				join(root, "backlog", "config.yml"),
				"project_name: Outcome test\ntask_prefix: TASK\nfilesystem_only: true\n",
			);
			writeFileSync(join(root, "backlog", "task-schema.yml"), configured);
			const core = new Core(root);
			const created = await core.createTaskFromInput({ title: "One" });
			const id = created.task.id;
			await core.editTask(id, { schemaFields: { tech_action: "Investigating" } }, false);
			await core.editTask(id, { schemaFields: { status: "Closed", outcome: "Deferred" } }, false);
			let task = await core.filesystem.loadTask(id);
			expect(task?.fieldValues?.outcome).toBe("Deferred");
			expect(task?.fieldValues?.tech_action).toBeUndefined();
			expect(task?.rawContent).toContain("Tech action: Investigating → ∅");
			expect(task?.fieldValues?.outcome_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			await core.editTask(id, { schemaFields: { status: "In Progress" } }, false);
			task = await core.filesystem.loadTask(id);
			expect(task?.fieldValues?.outcome).toBeUndefined();
			expect(task?.fieldValues?.outcome_date).toBeUndefined();
			await core.editTask(id, { schemaFields: { tech_action: "Testing" } }, false);
			const moved = await core.filesystem.loadTask(id);
			expect(moved).toBeDefined();
			moved!.status = "Closed";
			await core.updateTask(moved!, false);
			const closed = await core.filesystem.loadTask(id);
			expect(closed?.fieldValues?.tech_action).toBeUndefined();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
