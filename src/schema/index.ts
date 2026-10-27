import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { taskFrontmatter } from "../markdown/task-frontmatter.ts";
import type { Task } from "../types/index.ts";
import { getDefaultTaskSchema } from "./default-schema.ts";
import {
	FIELD_TYPES,
	type FieldType,
	type SchemaField,
	type SchemaIssue,
	type SchemaSection,
	type SchemaUser,
	type TaskSchema,
	TaskSchemaError,
} from "./types.ts";

export { getDefaultTaskSchema, getDefaultTaskSchemaText } from "./default-schema.ts";
export * from "./types.ts";

const CORE_FIELD_TYPES: Record<string, FieldType> = {
	id: "id",
	title: "text",
	status: "enum",
	assignee: "user-list",
	reporter: "user",
	created_date: "datetime",
	updated_date: "datetime",
	due_date: "date",
	labels: "string-list",
	milestone: "milestone-ref",
	dependencies: "task-ref-list",
	references: "string-list",
	documentation: "string-list",
	modified_files: "string-list",
	parent_task_id: "task-ref",
	subtasks: "task-ref-list",
	priority: "enum",
	type: "enum",
	project: "enum",
	ordinal: "number",
	onStatusChange: "text",
	// Branch is derived from Git and exposed through the canonical field access layer.
	branch: "text",
};

const MANAGED_CORE_FIELDS = new Set(["id", "created_date", "updated_date", "subtasks", "ordinal", "branch"]);
const FILTERABLE_TYPES = new Set<FieldType>([
	"enum",
	"multi-enum",
	"bool",
	"date",
	"user",
	"user-list",
	"string-list",
	"milestone-ref",
	"sequence",
]);
export const MOVED_CONFIG_KEYS: Record<string, string> = {
	statuses: "fields.status.values",
	default_status: "fields.status.default",
	labels: "fields.labels",
	types: "fields.type.values",
	priorities: "fields.priority.values",
	projects: "fields.project.values",
	default_assignee: "fields.assignee.default",
	default_reporter: "users.default",
	definition_of_done: "sections",
};
const FIELD_ATTRIBUTES = new Set([
	"type",
	"label",
	"description",
	"core",
	"managed",
	"hidden",
	"required",
	"default",
	"values",
	"lang",
	"translation_of",
	"track_changes",
	"overdue_when",
	"scope",
	"prefixes",
	"pad",
	"assign_when",
]);
const SECTION_ATTRIBUTES = new Set(["kind", "title", "description", "lang", "translation_of", "required"]);
const USER_ATTRIBUTES = new Set(["handle", "name", "default"]);
const FIELD_ID = /^[a-z][a-z0-9_]{0,39}$/;
const USER_HANDLE = /^@[A-Za-z0-9._-]+$/;
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function stringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function addUnknownAttributes(
	value: Record<string, unknown>,
	allowed: Set<string>,
	key: string,
	issues: SchemaIssue[],
): void {
	for (const attribute of Object.keys(value)) {
		if (!allowed.has(attribute)) issues.push({ key: `${key}.${attribute}`, message: "Unknown attribute" });
	}
}

function validateTranslation(
	id: string,
	definition: { translation_of?: string; lang?: string },
	definitions: Record<string, { type?: string; kind?: string; translation_of?: string }>,
	kind: "field" | "section",
	issues: SchemaIssue[],
): void {
	if (definition.lang !== undefined && (typeof definition.lang !== "string" || !LANGUAGE_TAG.test(definition.lang))) {
		issues.push({ key: `${kind}s.${id}.lang`, message: "Expected a BCP-47 language tag" });
	}
	if (definition.translation_of === undefined) return;
	if (
		typeof definition.translation_of !== "string" ||
		!definitions[definition.translation_of] ||
		definition.translation_of === id
	) {
		issues.push({ key: `${kind}s.${id}.translation_of`, message: "Expected another declared key" });
		return;
	}
	const target = definitions[definition.translation_of];
	if (target?.[kind === "field" ? "type" : "kind"] !== definitions[id]?.[kind === "field" ? "type" : "kind"]) {
		issues.push({
			key: `${kind}s.${id}.translation_of`,
			message: `Translation must have the same ${kind === "field" ? "type" : "kind"}`,
		});
	}
	if (!definition.lang) issues.push({ key: `${kind}s.${id}.lang`, message: "A translation needs a language tag" });
}

function validDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function validDefault(field: SchemaField, value: unknown, users: SchemaUser[]): boolean {
	const handleAllowed = (handle: unknown) =>
		typeof handle === "string" &&
		USER_HANDLE.test(handle) &&
		(users.length === 0 || users.some((user) => user.handle === handle));
	switch (field.type) {
		case "bool":
			return typeof value === "boolean";
		case "number":
			return typeof value === "number" && Number.isFinite(value);
		case "date":
			return typeof value === "string" && validDate(value);
		case "datetime":
			return (
				typeof value === "string" &&
				(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value))
			);
		case "enum":
			return (
				typeof value === "string" && (field.values ?? []).some((item) => item.toLowerCase() === value.toLowerCase())
			);
		case "multi-enum":
			return (
				stringArray(value) &&
				value.every((item) => (field.values ?? []).some((allowed) => allowed.toLowerCase() === item.toLowerCase()))
			);
		case "string-list":
			return stringArray(value);
		case "user":
			return handleAllowed(value);
		case "user-list":
			return Array.isArray(value) && value.every(handleAllowed);
		case "task-ref-list":
			return stringArray(value);
		case "id":
		case "text":
		case "sequence":
		case "task-ref":
		case "milestone-ref":
			return typeof value === "string";
	}
}

function validateCondition(
	value: unknown,
	path: string,
	fields: Record<string, SchemaField>,
	users: SchemaUser[],
	issues: SchemaIssue[],
): void {
	const conditions = record(value);
	if (!conditions) {
		issues.push({ key: path, message: "Expected a mapping of field keys to allowed values" });
		return;
	}
	for (const [key, raw] of Object.entries(conditions)) {
		const field = fields[key];
		if (!field || !["enum", "multi-enum", "bool", "user-list"].includes(field.type)) {
			issues.push({ key: `${path}.${key}`, message: "Condition field must be an enum, multi-enum, bool or user-list" });
			continue;
		}
		const values = Array.isArray(raw) ? raw : [raw];
		if (!values.length) issues.push({ key: `${path}.${key}`, message: "Expected at least one value" });
		for (const item of values) {
			const valid =
				field.type === "bool"
					? typeof item === "boolean"
					: typeof item === "string" &&
						(field.type === "user-list"
							? USER_HANDLE.test(item) && (users.length === 0 || users.some((user) => user.handle === item))
							: field.values?.includes(item));
			if (!valid) issues.push({ key: `${path}.${key}`, message: `Invalid condition value: ${String(item)}` });
		}
	}
}

function validateUsers(value: unknown, issues: SchemaIssue[]): SchemaUser[] {
	if (!Array.isArray(value)) {
		issues.push({ key: "users", message: "Expected a list" });
		return [];
	}
	const users: SchemaUser[] = [];
	for (const [index, raw] of value.entries()) {
		const item = record(raw);
		if (!item) {
			issues.push({ key: `users.${index}`, message: "Expected a user object" });
			continue;
		}
		addUnknownAttributes(item, USER_ATTRIBUTES, `users.${index}`, issues);
		if (typeof item.handle !== "string" || !USER_HANDLE.test(item.handle))
			issues.push({
				key: `users.${index}.handle`,
				message: "Expected @ followed by letters, numbers, dot, underscore or hyphen",
			});
		if (typeof item.name !== "string" || !item.name.trim())
			issues.push({ key: `users.${index}.name`, message: "Expected a nonempty name" });
		if (item.default !== undefined && typeof item.default !== "boolean")
			issues.push({ key: `users.${index}.default`, message: "Expected true or false" });
		users.push(item as unknown as SchemaUser);
	}
	if (users.length > 0 && users.filter((user) => user.default === true).length !== 1)
		issues.push({ key: "users", message: "Exactly one user must have default: true" });
	const handles = users.map((user) => user.handle);
	if (new Set(handles).size !== handles.length) issues.push({ key: "users", message: "User handles must be unique" });
	return users;
}

function validateFields(value: unknown, users: SchemaUser[], issues: SchemaIssue[]): Record<string, SchemaField> {
	const source = record(value);
	if (!source) {
		issues.push({ key: "fields", message: "Expected a mapping" });
		return {};
	}
	const fields: Record<string, SchemaField> = {};
	for (const [key, raw] of Object.entries(source)) {
		const item = record(raw);
		if (!item) {
			issues.push({ key: `fields.${key}`, message: "Expected a field definition" });
			continue;
		}
		addUnknownAttributes(item, FIELD_ATTRIBUTES, `fields.${key}`, issues);
		if (!CORE_FIELD_TYPES[key] && !FIELD_ID.test(key))
			issues.push({ key: `fields.${key}`, message: "Custom field key must match ^[a-z][a-z0-9_]{0,39}$" });
		if (!FIELD_TYPES.includes(item.type as FieldType))
			issues.push({ key: `fields.${key}.type`, message: `Expected one of ${FIELD_TYPES.join(", ")}` });
		const coreType = CORE_FIELD_TYPES[key];
		if (coreType && item.core !== true)
			issues.push({ key: `fields.${key}.core`, message: "Persisted core field must have core: true" });
		if (coreType && item.type !== coreType)
			issues.push({ key: `fields.${key}.type`, message: `Core field type must be ${coreType}` });
		if (!coreType && item.core === true)
			issues.push({ key: `fields.${key}.core`, message: "Only built-in fields can be core" });
		if (MANAGED_CORE_FIELDS.has(key) && item.managed !== true)
			issues.push({ key: `fields.${key}.managed`, message: "This field must be managed" });
		if (!coreType && item.managed === true)
			issues.push({ key: `fields.${key}.managed`, message: "Managed fields must be core" });
		for (const flag of ["core", "managed", "hidden", "required", "track_changes"]) {
			if (item[flag] !== undefined && typeof item[flag] !== "boolean")
				issues.push({ key: `fields.${key}.${flag}`, message: "Expected true or false" });
		}
		for (const attribute of ["label", "description", "lang", "translation_of"]) {
			if (item[attribute] !== undefined && typeof item[attribute] !== "string")
				issues.push({ key: `fields.${key}.${attribute}`, message: "Expected text" });
		}
		if (item.type === "enum" || item.type === "multi-enum") {
			if (!stringArray(item.values) || (item.values.length === 0 && key !== "project"))
				issues.push({ key: `fields.${key}.values`, message: "Expected a nonempty list of allowed values" });
			else if (new Set(item.values.map((value) => value.toLowerCase())).size !== item.values.length)
				issues.push({ key: `fields.${key}.values`, message: "Values must be unique ignoring case" });
		} else if (key === "labels" && item.type === "string-list" && item.values !== undefined) {
			if (!stringArray(item.values))
				issues.push({ key: `fields.${key}.values`, message: "Expected a list of label suggestions" });
		} else if (item.values !== undefined)
			issues.push({ key: `fields.${key}.values`, message: "Only enum fields can have values" });
		fields[key] = item as unknown as SchemaField;
	}
	for (const [key, type] of Object.entries(CORE_FIELD_TYPES)) {
		if (!fields[key]) issues.push({ key: `fields.${key}`, message: `Missing core field (${type})` });
	}
	for (const [key, field] of Object.entries(fields)) {
		validateTranslation(key, field, fields, "field", issues);
		if (field.overdue_when !== undefined) {
			if (field.type !== "date")
				issues.push({ key: `fields.${key}.overdue_when`, message: "Only date fields can declare overdue_when" });
			validateCondition(field.overdue_when, `fields.${key}.overdue_when`, fields, users, issues);
		}
		if (field.type === "sequence") {
			if (field.default !== undefined)
				issues.push({
					key: `fields.${key}.default`,
					message: "Sequence references are assigned on save and cannot have a default",
				});
			const scope = typeof field.scope === "string" ? fields[field.scope] : undefined;
			if (!scope || scope.type !== "enum")
				issues.push({ key: `fields.${key}.scope`, message: "Scope must name an enum field" });
			const prefixes = record(field.prefixes);
			if (
				!prefixes ||
				!scope ||
				Object.keys(prefixes).length !== (scope.values ?? []).length ||
				(scope.values ?? []).some((value) => !Object.hasOwn(prefixes, value))
			)
				issues.push({ key: `fields.${key}.prefixes`, message: "Prefixes must cover every scope value" });
			if (prefixes) {
				const values = Object.values(prefixes);
				if (values.some((value) => typeof value !== "string" || !/^[A-Z][A-Z0-9]{1,9}$/.test(value)))
					issues.push({ key: `fields.${key}.prefixes`, message: "Prefixes must match ^[A-Z][A-Z0-9]{1,9}$" });
				if (new Set(values).size !== values.length)
					issues.push({ key: `fields.${key}.prefixes`, message: "Prefixes must be unique" });
			}
			if (!Number.isInteger(field.pad) || field.pad! < 1 || field.pad! > 6)
				issues.push({ key: `fields.${key}.pad`, message: "Padding must be an integer from 1 to 6" });
			if (field.assign_when !== undefined)
				validateCondition(field.assign_when, `fields.${key}.assign_when`, fields, users, issues);
		} else if (
			field.scope !== undefined ||
			field.prefixes !== undefined ||
			field.pad !== undefined ||
			field.assign_when !== undefined
		) {
			issues.push({ key: `fields.${key}`, message: "Sequence attributes require type: sequence" });
		}
		if (field.default !== undefined && !validDefault(field, field.default, users))
			issues.push({ key: `fields.${key}.default`, message: `Invalid default for ${field.type}` });
		if (field.required && field.default === "")
			issues.push({ key: `fields.${key}.default`, message: "Required field cannot default to empty text" });
	}
	return fields;
}

function validateSections(value: unknown, issues: SchemaIssue[]): Record<string, SchemaSection> {
	const source = record(value);
	if (!source) {
		issues.push({ key: "sections", message: "Expected a mapping" });
		return {};
	}
	const sections: Record<string, SchemaSection> = {};
	for (const [key, raw] of Object.entries(source)) {
		const item = record(raw);
		if (!item) {
			issues.push({ key: `sections.${key}`, message: "Expected a section definition" });
			continue;
		}
		addUnknownAttributes(item, SECTION_ATTRIBUTES, `sections.${key}`, issues);
		if (!FIELD_ID.test(key))
			issues.push({ key: `sections.${key}`, message: "Section ID must match ^[a-z][a-z0-9_]{0,39}$" });
		if (!["markdown", "checklist", "log"].includes(String(item.kind)))
			issues.push({ key: `sections.${key}.kind`, message: "Expected markdown, checklist or log" });
		if (typeof item.title !== "string" || !item.title.trim())
			issues.push({ key: `sections.${key}.title`, message: "Expected a nonempty title" });
		if (item.required !== undefined && typeof item.required !== "boolean")
			issues.push({ key: `sections.${key}.required`, message: "Expected true or false" });
		if (item.description !== undefined && typeof item.description !== "string")
			issues.push({ key: `sections.${key}.description`, message: "Expected text" });
		sections[key] = item as unknown as SchemaSection;
	}
	for (const [key, section] of Object.entries(sections)) validateTranslation(key, section, sections, "section", issues);
	return sections;
}

function validateArea(
	source: Record<string, unknown> | null,
	path: string,
	name: string,
	fields: Record<string, SchemaField>,
	issues: SchemaIssue[],
	filter = false,
): string[] {
	const value = source?.[name];
	if (!stringArray(value)) {
		issues.push({ key: `${path}.${name}`, message: "Expected a list of field keys" });
		return [];
	}
	if (new Set(value).size !== value.length)
		issues.push({ key: `${path}.${name}`, message: "Field keys must not repeat" });
	for (const key of value) {
		const field = fields[key];
		if (!field) issues.push({ key: `${path}.${name}`, message: `Unknown field ${key}` });
		else if (
			((path === "ui.board" && name === "card") || (path === "ui.task_list" && name === "columns")) &&
			(key === "id" || key === "title")
		)
			issues.push({ key: `${path}.${name}`, message: `${key} is always shown and must not be listed` });
		else if (field.hidden) issues.push({ key: `${path}.${name}`, message: `Hidden field ${key} cannot appear here` });
		else if (filter && !FILTERABLE_TYPES.has(field.type))
			issues.push({ key: `${path}.${name}`, message: `Field ${key} (${field.type}) cannot be filtered here` });
	}
	return value;
}

function validateUi(value: unknown, fields: Record<string, SchemaField>, issues: SchemaIssue[]): TaskSchema["ui"] {
	const source = record(value);
	if (!source) issues.push({ key: "ui", message: "Expected a mapping" });
	if (source)
		addUnknownAttributes(source, new Set(["board", "task_list", "statistics", "milestones", "detail"]), "ui", issues);
	const board = record(source?.board);
	const taskList = record(source?.task_list);
	const statistics = source?.statistics === undefined ? null : record(source.statistics);
	const milestones = record(source?.milestones);
	const detail = record(source?.detail);
	for (const [name, area, attributes] of [
		["board", board, ["card", "filters"]],
		["task_list", taskList, ["columns", "filters"]],
		["statistics", statistics, ["filters"]],
		["milestones", milestones, ["row"]],
		["detail", detail, ["order"]],
	] as const) {
		if (!area && !(name === "statistics" && source?.statistics === undefined))
			issues.push({ key: `ui.${name}`, message: "Expected a mapping" });
		else if (area) addUnknownAttributes(area, new Set(attributes), `ui.${name}`, issues);
	}
	return {
		board: {
			card: validateArea(board, "ui.board", "card", fields, issues),
			filters: validateArea(board, "ui.board", "filters", fields, issues, true),
		},
		task_list: {
			columns: validateArea(taskList, "ui.task_list", "columns", fields, issues),
			filters: validateArea(taskList, "ui.task_list", "filters", fields, issues, true),
		},
		statistics: {
			filters: statistics
				? validateArea(statistics, "ui.statistics", "filters", fields, issues, true)
				: ["project", "assignee"].filter((key) => fields[key] && !fields[key].hidden),
		},
		milestones: { row: validateArea(milestones, "ui.milestones", "row", fields, issues) },
		detail: { order: validateArea(detail, "ui.detail", "order", fields, issues) },
	};
}

export function parseTaskSchema(content: string, path?: string): TaskSchema {
	let data: unknown;
	try {
		data = matter(`---\n${content.replace(/\n?$/, "\n")}---\n`).data;
	} catch (error) {
		throw new TaskSchemaError([{ key: "yaml", message: error instanceof Error ? error.message : String(error) }], path);
	}
	const source = record(data);
	if (!source) throw new TaskSchemaError([{ key: "root", message: "Expected a YAML mapping" }], path);
	const issues: SchemaIssue[] = [];
	for (const key of Object.keys(source)) {
		if (!["users", "fields", "sections", "ui"].includes(key)) issues.push({ key, message: "Unknown top-level key" });
	}
	const users = validateUsers(source.users, issues);
	const fields = validateFields(source.fields, users, issues);
	const sections = validateSections(source.sections, issues);
	const ui = validateUi(source.ui, fields, issues);
	if (issues.length) throw new TaskSchemaError(issues, path);
	return { users, fields, sections, ui };
}

export function loadTaskSchema(backlogDir: string, configPath = join(backlogDir, "config.yml")): TaskSchema {
	const schemaPath = join(backlogDir, "task-schema.yml");
	const oldPath = join(backlogDir, "fields.yml");
	if (existsSync(oldPath))
		throw new TaskSchemaError(
			[{ key: "fields.yml", message: "Replace fields.yml with task-schema.yml; automatic migration is not supported" }],
			oldPath,
		);
	if (existsSync(configPath)) {
		const config = readFileSync(configPath, "utf8");
		const lines = config.split(/\r?\n/).map((line) => line.trimStart());
		const leftovers = Object.entries(MOVED_CONFIG_KEYS).filter(([key]) =>
			lines.some((line) => line.startsWith(`${key}:`)),
		);
		if (leftovers.length)
			throw new TaskSchemaError(
				leftovers.map(([key, home]) => ({ key, message: `Move this config.yml key to task-schema.yml ${home}` })),
				configPath,
			);
	}
	if (!existsSync(schemaPath)) return getDefaultTaskSchema();
	return parseTaskSchema(readFileSync(schemaPath, "utf8"), schemaPath);
}

// Keep the schema's core registry tied to the serializer, not a copied plan list.
export function assertCoreRegistryMatchesSerializer(): void {
	const persisted = Object.keys(taskFrontmatter({} as Task));
	const declared = Object.keys(CORE_FIELD_TYPES).filter((key) => key !== "branch");
	const missing = persisted.filter((key) => !declared.includes(key));
	const extra = declared.filter((key) => !persisted.includes(key));
	if (missing.length || extra.length)
		throw new Error(
			`Core field registry differs from taskFrontmatter: missing ${missing.join(", ")}; extra ${extra.join(", ")}`,
		);
}
