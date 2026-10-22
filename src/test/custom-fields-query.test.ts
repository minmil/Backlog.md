import { describe, expect, it } from "bun:test";
import type { Task } from "../types/index.ts";
import {
	type CustomFieldSchema,
	matchesCustomFieldConditions,
	parseCustomFieldCondition,
} from "../utils/custom-fields.ts";
import { sortTasks } from "../utils/task-sorting.ts";

const schema: CustomFieldSchema = {
	fields: {
		active: { type: "bool", trackChanges: false },
		stage: { type: "enum", values: ["Pending", "Testing", "Released"], trackChanges: false },
		day: { type: "date", trackChanges: false },
		note: { type: "text", trackChanges: false },
	},
};
const today = new Date(2026, 9, 22, 12);

function task(id: string, customFields: Task["customFields"]): Task {
	return { id, title: id, status: "To Do", assignee: [], createdDate: "", labels: [], dependencies: [], customFields };
}

const tasks = [
	task("TASK-1", { active: true, stage: "Released", day: "2026-10-23", note: "Hello=world" }),
	task("TASK-2", { active: false, stage: "Pending", day: "2026-10-22" }),
	task("TASK-3", { stage: "Testing", day: "2026-10-30" }),
	task("TASK-4", {}),
];

function ids(expression: string): string[] {
	const condition = parseCustomFieldCondition(expression, schema, today);
	return tasks
		.filter((candidate) => matchesCustomFieldConditions(candidate, [condition]))
		.map((candidate) => candidate.id);
}

describe("custom field filters and sorting", () => {
	it("matches equality, inequality, set/unset, alternatives and boolean aliases", () => {
		expect(ids("active=yes")).toEqual(["TASK-1"]);
		expect(ids("active=false")).toEqual(["TASK-2"]);
		expect(ids("active!=")).toEqual(["TASK-1", "TASK-2"]);
		expect(ids("active=")).toEqual(["TASK-3", "TASK-4"]);
		expect(ids("active!=true")).toEqual(["TASK-2"]);
		expect(ids("stage=testing|released")).toEqual(["TASK-1", "TASK-3"]);
		expect(ids("stage!=testing")).toEqual(["TASK-1", "TASK-2"]);
		expect(ids("note=Hello=world")).toEqual(["TASK-1"]);
		expect(ids("note=")).toEqual(["TASK-2", "TASK-3", "TASK-4"]);
	});

	it("compares dates with all operators and resolves relative days locally", () => {
		expect(ids("day<2026-10-23")).toEqual(["TASK-2"]);
		expect(ids("day<=today")).toEqual(["TASK-2"]);
		expect(ids("day>today")).toEqual(["TASK-1", "TASK-3"]);
		expect(ids("day>=+1d")).toEqual(["TASK-1", "TASK-3"]);
		expect(ids("day<=+7d")).toEqual(["TASK-1", "TASK-2"]);
		expect(ids("day=-1d")).toEqual([]);
	});

	it("combines conditions with AND", () => {
		const conditions = ["active=", "stage=Testing"].map((expression) =>
			parseCustomFieldCondition(expression, schema, today),
		);
		expect(
			tasks.filter((candidate) => matchesCustomFieldConditions(candidate, conditions)).map((candidate) => candidate.id),
		).toEqual(["TASK-3"]);
	});

	it("rejects built-ins, invalid comparisons, and invalid values", () => {
		expect(() => parseCustomFieldCondition("status!=Done", schema, today)).toThrow("--where is for custom fields only");
		expect(() => parseCustomFieldCondition("stage<Testing", schema, today)).toThrow("comparisons require a date");
		expect(() => parseCustomFieldCondition("day<yesterday", schema, today)).toThrow("YYYY-MM-DD");
		expect(() => parseCustomFieldCondition("active=maybe", schema, today)).toThrow("true/false");
	});

	it("sorts dates and enums in schema order with unset values last", () => {
		expect(sortTasks(tasks, "day", undefined, schema).map((candidate) => candidate.id)).toEqual([
			"TASK-2",
			"TASK-1",
			"TASK-3",
			"TASK-4",
		]);
		expect(sortTasks(tasks, "day:desc", undefined, schema).map((candidate) => candidate.id)).toEqual([
			"TASK-3",
			"TASK-1",
			"TASK-2",
			"TASK-4",
		]);
		expect(sortTasks(tasks, "stage", undefined, schema).map((candidate) => candidate.id)).toEqual([
			"TASK-2",
			"TASK-3",
			"TASK-1",
			"TASK-4",
		]);
	});
});
