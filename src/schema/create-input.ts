import type { TaskCreateInput } from "../types/index.ts";
import type { FieldRegistry } from "./field-registry.ts";

const CORE_INPUT_KEYS: Record<string, keyof TaskCreateInput> = {
	title: "title",
	status: "status",
	assignee: "assignee",
	reporter: "reporter",
	due_date: "dueDate",
	labels: "labels",
	milestone: "milestone",
	dependencies: "dependencies",
	references: "references",
	documentation: "documentation",
	modified_files: "modifiedFiles",
	parent_task_id: "parentTaskId",
	priority: "priority",
	type: "type",
	project: "project",
	ordinal: "ordinal",
	onStatusChange: "onStatusChange",
};

function applyCreateFields(
	registry: FieldRegistry,
	base: TaskCreateInput,
	assignments: Record<string, unknown>,
	parse: (key: string, raw: unknown) => unknown,
): TaskCreateInput {
	const result: TaskCreateInput = { ...base, fieldValues: { ...base.fieldValues } };
	for (const [key, raw] of Object.entries(assignments)) {
		const definition = registry.schema.fields[key];
		if (!definition)
			throw new Error(
				`Unknown task field "${key}". Declared fields: ${Object.keys(registry.schema.fields).join(", ")}`,
			);
		if (definition.managed && key !== "ordinal") throw new Error(`Task field "${key}" is managed by Backlog`);
		if (raw === null) {
			if (definition.required) throw new Error(`Task field "${key}" is required`);
			continue;
		}
		const value = parse(key, raw);
		if (definition.core) {
			const property = CORE_INPUT_KEYS[key];
			if (!property) throw new Error(`Task field "${key}" cannot be supplied on create`);
			(result as unknown as Record<string, unknown>)[property] = value;
		} else {
			result.fieldValues ??= {};
			result.fieldValues[key] = value;
		}
	}
	return result;
}

/** Apply --field assignments before create validation or disk writes. */
export function applyCreateFieldAssignments(
	registry: FieldRegistry,
	base: TaskCreateInput,
	assignments: Record<string, string>,
): TaskCreateInput {
	return applyCreateFields(registry, base, assignments, (key, raw) => registry.parseInput(key, raw as string));
}

/** Apply native JSON field values through the same registry used by CLI assignments. */
export function applyCreateFieldValues(
	registry: FieldRegistry,
	base: TaskCreateInput,
	values: Record<string, unknown>,
): TaskCreateInput {
	return applyCreateFields(registry, base, values, (key, raw) => registry.validateValue(key, raw));
}
