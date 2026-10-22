import { readFileSync } from "node:fs";
import { join } from "node:path";
import { taskFrontmatter } from "../markdown/task-frontmatter.ts";
import type { Task } from "../types/index.ts";
import { normalizeDueDate } from "./due-date.ts";

export type CustomFieldType = "bool" | "date" | "enum" | "text";
export type CustomFieldValue = string | boolean;

export interface CustomFieldDefinition {
	type: CustomFieldType;
	values?: string[];
	default?: CustomFieldValue;
	description?: string;
	trackChanges: boolean;
}

export interface CustomFieldSchema {
	fields: Record<string, CustomFieldDefinition>;
}

export interface CustomFieldCondition {
	key: string;
	operator: "=" | "!=" | "<" | "<=" | ">" | ">=";
	values: CustomFieldValue[];
	/** Empty equality means unset; empty inequality means set. */
	presence?: "set" | "unset";
}

const schemaCache = new Map<string, { source: string | null; schema: CustomFieldSchema }>();

function isMapping(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/** The serializer's owned keys are the source of truth for reserved names. */
export function getReservedFieldNames(): Set<string> {
	const example: Task = {
		id: "",
		title: "",
		status: "",
		assignee: [],
		createdDate: "",
		labels: [],
		dependencies: [],
	};
	return new Set([...Object.keys(taskFrontmatter(example)), "branch", "on_status_change"]);
}

export function normalizeCustomFieldValue(
	definition: CustomFieldDefinition,
	raw: unknown,
): { ok: true; value: CustomFieldValue | undefined } | { ok: false; error: string } {
	if (raw === undefined || raw === null) return { ok: true, value: undefined };
	switch (definition.type) {
		case "bool": {
			if (typeof raw === "boolean") return { ok: true, value: raw };
			const value = String(raw).trim().toLowerCase();
			if (["true", "yes", "y", "1"].includes(value)) return { ok: true, value: true };
			if (["false", "no", "n", "0"].includes(value)) return { ok: true, value: false };
			return { ok: false, error: "expected true/false, yes/no, y/n, or 1/0" };
		}
		case "date": {
			try {
				const value = normalizeDueDate(raw, "Custom field");
				if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
					return { ok: false, error: "expected a date in YYYY-MM-DD format" };
				}
				return { ok: true, value };
			} catch {
				return { ok: false, error: "expected a date in YYYY-MM-DD format" };
			}
		}
		case "enum": {
			const input = String(raw).trim().toLowerCase();
			const value = definition.values?.find((choice) => choice.toLowerCase() === input);
			return value
				? { ok: true, value }
				: { ok: false, error: `allowed values: ${definition.values?.join(", ") ?? ""}` };
		}
		case "text":
			return { ok: true, value: String(raw).trim() || undefined };
	}
}

/** Validate every requested mutation before a task is changed or written. */
export function normalizeCustomFieldAssignments(
	schema: CustomFieldSchema,
	assignments: Record<string, unknown> = {},
	clear: string[] = [],
): { values: Record<string, CustomFieldValue>; clear: string[] } {
	const values: Record<string, CustomFieldValue> = {};
	const declared = Object.keys(schema.fields);
	for (const name of [...Object.keys(assignments), ...clear]) {
		if (!Object.hasOwn(schema.fields, name)) {
			throw new Error(
				`Unknown custom field "${name}". Declared fields: ${declared.length ? declared.join(", ") : "(none)"}`,
			);
		}
	}
	for (const name of clear) {
		if (Object.hasOwn(assignments, name)) {
			throw new Error(`Cannot set and clear custom field "${name}" in the same command.`);
		}
	}
	for (const [name, raw] of Object.entries(assignments)) {
		const definition = schema.fields[name] as CustomFieldDefinition;
		const normalized = normalizeCustomFieldValue(definition, raw);
		if (!normalized.ok) throw new Error(`Invalid custom field "${name}": ${normalized.error}`);
		if (normalized.value === undefined) {
			if (definition.type === "text") {
				clear.push(name);
				continue;
			}
			throw new Error(`Invalid custom field "${name}": value is empty; use --clear-field ${name} to unset it.`);
		}
		values[name] = normalized.value;
	}
	return { values, clear: [...new Set(clear)] };
}

function localDay(date: Date): string {
	const year = String(date.getFullYear()).padStart(4, "0");
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function currentLocalDay(): Date {
	const override = process.env.BACKLOG_CUSTOM_FIELDS_TODAY;
	if (!override) return new Date();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(override) || normalizeDueDate(override, "BACKLOG_CUSTOM_FIELDS_TODAY") !== override) {
		throw new Error("BACKLOG_CUSTOM_FIELDS_TODAY must be a date in YYYY-MM-DD format.");
	}
	const [year, month, day] = override.split("-").map(Number);
	return new Date(year as number, (month as number) - 1, day as number, 12);
}

export function parseCustomFieldCondition(
	expression: string,
	schema: CustomFieldSchema,
	today = currentLocalDay(),
): CustomFieldCondition {
	const match = expression.match(/^([a-z][a-z0-9_]*)(<=|>=|!=|<|>|=)(.*)$/);
	if (!match) throw new Error(`Invalid --where "${expression}". Use a custom field expression such as key=value.`);
	const [, key, operator, rawValue] = match;
	const definition = schema.fields[key as string];
	if (!definition) {
		throw new Error(
			`--where is for custom fields only. Unknown field "${key}". Use built-in flags for status, assignee, and other built-in fields. Declared fields: ${Object.keys(schema.fields).join(", ") || "(none)"}`,
		);
	}
	const op = operator as CustomFieldCondition["operator"];
	if (op !== "=" && op !== "!=" && definition.type !== "date") {
		throw new Error(`Invalid --where "${expression}": ${key} is ${definition.type}; comparisons require a date field.`);
	}
	if (rawValue === "") {
		if (op === "=" || op === "!=")
			return { key: key as string, operator: op, values: [], presence: op === "=" ? "unset" : "set" };
		throw new Error(`Invalid --where "${expression}": comparison needs a date value.`);
	}
	if (rawValue?.includes("|") && op !== "=" && op !== "!=") {
		throw new Error(`Invalid --where "${expression}": alternatives are supported only with = and !=.`);
	}
	const values = (rawValue as string).split("|").map((part) => {
		let raw = part;
		if (definition.type === "date") {
			if (part === "today") raw = localDay(today);
			else if (/^[+-]\d+d$/.test(part)) {
				const shifted = new Date(today.getFullYear(), today.getMonth(), today.getDate());
				shifted.setDate(shifted.getDate() + Number(part.slice(0, -1)));
				raw = localDay(shifted);
			}
		}
		const normalized = normalizeCustomFieldValue(definition, raw);
		if (!normalized.ok || normalized.value === undefined) {
			throw new Error(`Invalid --where "${expression}": ${normalized.ok ? "value is empty" : normalized.error}`);
		}
		return normalized.value;
	});
	return { key: key as string, operator: op, values };
}

export function matchesCustomFieldConditions(task: Task, conditions: CustomFieldCondition[]): boolean {
	return conditions.every(({ key, operator, values, presence }) => {
		const actual = task.customFields?.[key];
		if (presence === "unset") return actual === undefined;
		if (presence === "set") return actual !== undefined;
		if (actual === undefined) return false;
		if (operator === "=") return values.includes(actual);
		if (operator === "!=") return !values.includes(actual);
		if (typeof actual !== "string" || typeof values[0] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(actual)) {
			return false;
		}
		const expected = values[0];
		if (operator === "<") return actual < expected;
		if (operator === "<=") return actual <= expected;
		if (operator === ">") return actual > expected;
		return actual >= expected;
	});
}

function schemaError(name: string, message: string): never {
	throw new Error(`Invalid custom field "${name}": ${message}`);
}

export function loadCustomFieldSchema(backlogDir: string): CustomFieldSchema {
	const path = join(backlogDir, "fields.yml");
	let source: string | null;
	try {
		source = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		source = null;
	}
	const cached = schemaCache.get(path);
	if (cached?.source === source) return cached.schema;
	if (source === null) {
		const schema = { fields: {} };
		schemaCache.set(path, { source, schema });
		return schema;
	}
	let parsed: unknown;
	try {
		parsed = Bun.YAML.parse(source);
	} catch (error) {
		throw new Error(`Invalid custom field schema ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isMapping(parsed) || !isMapping(parsed.fields)) {
		throw new Error(`Invalid custom field schema ${path}: expected a "fields" mapping`);
	}
	const reserved = getReservedFieldNames();
	const fields: Record<string, CustomFieldDefinition> = {};
	for (const [name, input] of Object.entries(parsed.fields)) {
		if (!/^[a-z][a-z0-9_]{0,39}$/.test(name)) schemaError(name, "name must match ^[a-z][a-z0-9_]{0,39}$");
		if (reserved.has(name)) schemaError(name, "name is reserved for a built-in task field");
		if (!isMapping(input)) schemaError(name, "definition must be a mapping");
		const type = input.type;
		if (type !== "bool" && type !== "date" && type !== "enum" && type !== "text") {
			schemaError(name, "type must be bool, date, enum, or text");
		}
		const values = input.values;
		if (type === "enum") {
			if (
				!Array.isArray(values) ||
				values.length === 0 ||
				values.some((value) => typeof value !== "string" || !value.trim())
			) {
				schemaError(name, "enum requires a non-empty list of string values");
			}
			const choices = values as string[];
			if (new Set(choices.map((value) => value.toLowerCase())).size !== choices.length) {
				schemaError(name, "enum values must be unique ignoring case");
			}
		} else if (values !== undefined) {
			schemaError(name, "values is allowed only for enum fields");
		}
		if (input.description !== undefined && typeof input.description !== "string") {
			schemaError(name, "description must be text");
		}
		if (input.track_changes !== undefined && typeof input.track_changes !== "boolean") {
			schemaError(name, "track_changes must be a boolean");
		}
		const definition: CustomFieldDefinition = {
			type,
			...(type === "enum" ? { values: values as string[] } : {}),
			...(input.description !== undefined ? { description: input.description as string } : {}),
			trackChanges: input.track_changes === true,
		};
		if (Object.hasOwn(input, "default")) {
			const normalized = normalizeCustomFieldValue(definition, input.default);
			if (!normalized.ok || normalized.value === undefined) {
				schemaError(name, `invalid default: ${normalized.ok ? "value is empty" : normalized.error}`);
			}
			definition.default = normalized.value;
		}
		fields[name] = definition;
	}
	const schema = { fields };
	schemaCache.set(path, { source, schema });
	return schema;
}
