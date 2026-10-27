import { taskFrontmatter } from "../markdown/task-frontmatter.ts";
import type { Task } from "../types/index.ts";
import { parseSequenceReference } from "./sequence.ts";
import type { FieldType, SchemaCondition, SchemaField, TaskSchema } from "./types.ts";

export type FieldValue = string | number | boolean | string[];
export type FieldOperator = "=" | "!=" | "<" | "<=" | ">" | ">=";

export interface FieldCondition {
	key: string;
	operator: FieldOperator;
	values: FieldValue[];
	presence?: "set" | "unset";
}

const CORE_PROPERTIES: Record<string, keyof Task> = {
	id: "id",
	title: "title",
	status: "status",
	assignee: "assignee",
	reporter: "reporter",
	created_date: "createdDate",
	updated_date: "updatedDate",
	due_date: "dueDate",
	labels: "labels",
	milestone: "milestone",
	dependencies: "dependencies",
	references: "references",
	documentation: "documentation",
	modified_files: "modifiedFiles",
	parent_task_id: "parentTaskId",
	subtasks: "subtasks",
	priority: "priority",
	type: "type",
	project: "project",
	ordinal: "ordinal",
	onStatusChange: "onStatusChange",
	branch: "branch",
};

const LIST_TYPES = new Set<FieldType>(["multi-enum", "string-list", "user-list", "task-ref-list"]);
const COMPARABLE_TYPES = new Set<FieldType>(["date", "datetime", "number"]);
const FILTERABLE_TYPES = new Set<FieldType>([
	"enum",
	"multi-enum",
	"bool",
	"date",
	"datetime",
	"number",
	"user",
	"user-list",
	"string-list",
	"milestone-ref",
	"sequence",
]);
const USER_HANDLE = /^@[A-Za-z0-9._-]+$/;

function validDay(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function validDateTime(value: string): boolean {
	const date = value.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/);
	if (!date || !validDay(date[1] ?? "")) return false;
	return Number(date[2]) < 24 && Number(date[3]) < 60;
}

function relativeDay(value: string, today: Date): string {
	if (value !== "today" && !/^[+-]\d+d$/.test(value)) return value;
	const day = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
	if (value !== "today") day.setDate(day.getDate() + Number(value.slice(0, -1)));
	return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

function isValue(value: unknown): value is FieldValue {
	return (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean" ||
		(Array.isArray(value) && value.every((item) => typeof item === "string"))
	);
}

export class FieldRegistry {
	private readonly users: Set<string>;

	constructor(
		readonly schema: TaskSchema,
		private readonly references: { taskIds?: Set<string>; milestoneIds?: Set<string> } = {},
	) {
		this.users = new Set(schema.users.map((user) => user.handle));
		const persisted = Object.keys(taskFrontmatter({} as Task));
		const mapped = Object.keys(CORE_PROPERTIES).filter((key) => key !== "branch");
		if (persisted.some((key) => !mapped.includes(key)) || mapped.some((key) => !persisted.includes(key))) {
			throw new Error("Field registry core keys differ from the task serializer");
		}
	}

	private definition(key: string): SchemaField {
		const field = this.schema.fields[key];
		if (!field)
			throw new Error(`Unknown task field "${key}". Declared fields: ${Object.keys(this.schema.fields).join(", ")}`);
		return field;
	}

	getField(task: Task, key: string): FieldValue | undefined {
		const field = this.definition(key);
		const value = field.core
			? key === "branch"
				? task.branch
				: (taskFrontmatter(task) as Record<string, unknown>)[key]
			: task.fieldValues?.[key];
		return isValue(value) ? value : undefined;
	}

	parseInput(key: string, raw: string): FieldValue {
		const field = this.definition(key);
		if (LIST_TYPES.has(field.type))
			return this.validateValue(
				key,
				raw
					.split(",")
					.map((part) => part.trim())
					.filter(Boolean),
			);
		return this.validateValue(key, raw);
	}

	validateValue(key: string, raw: unknown): FieldValue {
		const field = this.definition(key);
		const fail = (message: string): never => {
			throw new Error(`Invalid task field "${key}": ${message}`);
		};
		const list = (value: unknown): string[] => {
			if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
				return fail("expected a list of text values");
			return value as string[];
		};
		const enumValue = (value: unknown): string => {
			if ((field.values ?? []).length === 0)
				return fail(`no values configured; add values to task-schema.yml fields.${key}.values`);
			if (typeof value !== "string") return fail(`allowed values: ${(field.values ?? []).join(", ")}`);
			const match = field.values?.find((option) => option.toLowerCase() === value.trim().toLowerCase());
			return match ?? fail(`allowed values: ${(field.values ?? []).join(", ")}`);
		};
		const userValue = (value: unknown): string => {
			if (typeof value !== "string" || !USER_HANDLE.test(value) || (this.users.size > 0 && !this.users.has(value))) {
				return fail(`expected a configured @handle${this.users.size ? `: ${[...this.users].join(", ")}` : ""}`);
			}
			return value;
		};
		const taskRef = (value: unknown): string => {
			if (typeof value !== "string" || !value.trim()) return fail("expected a task ID");
			if (this.references.taskIds && !this.references.taskIds.has(value)) return fail(`task ${value} does not exist`);
			return value;
		};
		switch (field.type) {
			case "id":
			case "text":
				return typeof raw === "string" ? raw : fail("expected text");
			case "sequence":
				return parseSequenceReference(raw, field)
					? (raw as string)
					: fail("expected a configured PREFIX-number reference with canonical padding");
			case "bool": {
				if (typeof raw === "boolean") return raw;
				const value = String(raw).trim().toLowerCase();
				if (["true", "yes", "y", "1"].includes(value)) return true;
				if (["false", "no", "n", "0"].includes(value)) return false;
				return fail("expected true/false, yes/no, y/n, or 1/0");
			}
			case "date":
				return typeof raw === "string" && validDay(raw) ? raw : fail("expected YYYY-MM-DD");
			case "datetime":
				return typeof raw === "string" && validDateTime(raw) ? raw : fail("expected YYYY-MM-DD HH:mm");
			case "number": {
				const value =
					typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
				return Number.isFinite(value) ? value : fail("expected a finite number");
			}
			case "enum":
				return enumValue(raw);
			case "multi-enum":
				return list(raw).map(enumValue);
			case "string-list":
				return list(raw);
			case "user":
				return userValue(raw);
			case "user-list":
				return list(raw).map(userValue);
			case "task-ref":
				return taskRef(raw);
			case "task-ref-list":
				return list(raw).map(taskRef);
			case "milestone-ref": {
				if (typeof raw !== "string" || !raw.trim()) return fail("expected a milestone ID");
				if (this.references.milestoneIds && !this.references.milestoneIds.has(raw))
					return fail(`milestone ${raw} does not exist`);
				return raw;
			}
		}
	}

	setField(task: Task, key: string, value: unknown, options: { allowManaged?: boolean } = {}): Task {
		const field = this.definition(key);
		if (field.managed && !options.allowManaged) throw new Error(`Task field "${key}" is managed by Backlog`);
		if (field.type === "sequence") {
			const existing = this.getField(task, key);
			if (existing !== undefined && existing !== value)
				throw new Error(`Task field "${key}" is a permanent reference and cannot be reassigned`);
		}
		const normalized =
			key === "status" && /^DRAFT-/i.test(task.id) && typeof value === "string" && value.toLowerCase() === "draft"
				? "Draft"
				: this.validateValue(key, value);
		if (field.required && (normalized === "" || (Array.isArray(normalized) && normalized.length === 0))) {
			throw new Error(`Task field "${key}" is required`);
		}
		const next: Task = { ...task };
		if (field.core) {
			(next as unknown as Record<string, unknown>)[CORE_PROPERTIES[key] as string] = normalized;
		} else {
			next.fieldValues = { ...task.fieldValues, [key]: normalized };
		}
		return next;
	}

	clearField(task: Task, key: string): Task {
		const field = this.definition(key);
		if (field.type === "sequence")
			throw new Error(`Task field "${key}" is a permanent reference and cannot be cleared`);
		if (field.managed || field.required) throw new Error(`Task field "${key}" cannot be cleared`);
		const next: Task = { ...task };
		if (field.core)
			(next as unknown as Record<string, unknown>)[CORE_PROPERTIES[key] as string] = LIST_TYPES.has(field.type)
				? []
				: undefined;
		else {
			next.fieldValues = { ...task.fieldValues };
			delete next.fieldValues[key];
		}
		return next;
	}

	parseCondition(expression: string, today = new Date()): FieldCondition {
		const match = expression.match(/^([a-z][a-z0-9_]*)(<=|>=|!=|<|>|=)(.*)$/);
		if (!match) throw new Error(`Invalid --where "${expression}". Expected key=value.`);
		const [, key = "", operator = "=", raw = ""] = match;
		const field = this.definition(key);
		if (!FILTERABLE_TYPES.has(field.type)) throw new Error(`Field ${key} (${field.type}) cannot be filtered`);
		const op = operator as FieldOperator;
		if (COMPARABLE_TYPES.has(field.type) === false && op !== "=" && op !== "!=")
			throw new Error(`Field ${key} does not support range comparisons`);
		if (!raw) {
			if (op !== "=" && op !== "!=") throw new Error(`Field ${key} comparison needs a value`);
			return { key, operator: op, values: [], presence: op === "=" ? "unset" : "set" };
		}
		if (raw.includes("|") && op !== "=" && op !== "!=") throw new Error("Alternatives require = or !=");
		const values = raw
			.split("|")
			.map((part) => this.parseInput(key, field.type === "date" ? relativeDay(part, today) : part));
		return { key, operator: op, values };
	}

	matches(task: Task, condition: FieldCondition): boolean {
		const actual = this.getField(task, condition.key);
		const empty = actual === undefined || (Array.isArray(actual) && actual.length === 0);
		if (condition.presence === "unset") return empty;
		if (condition.presence === "set") return !empty;
		if (actual === undefined) return false;
		const equal = (expected: FieldValue) =>
			Array.isArray(actual)
				? Array.isArray(expected)
					? expected.every((item) => actual.includes(item))
					: actual.includes(String(expected))
				: actual === expected;
		if (condition.operator === "=") return condition.values.some(equal);
		if (condition.operator === "!=") return condition.values.every((value) => !equal(value));
		const expected = condition.values[0];
		if (expected === undefined || Array.isArray(actual) || Array.isArray(expected)) return false;
		const comparison =
			typeof actual === "number" && typeof expected === "number"
				? actual - expected
				: String(actual).localeCompare(String(expected));
		switch (condition.operator) {
			case "<":
				return comparison < 0;
			case "<=":
				return comparison <= 0;
			case ">":
				return comparison > 0;
			case ">=":
				return comparison >= 0;
		}
	}

	conditionMatches(task: Task, conditions: SchemaCondition): boolean {
		return Object.entries(conditions).every(([key, raw]) => {
			const actual = this.getField(task, key);
			const allowed = Array.isArray(raw) ? raw : [raw];
			return Array.isArray(actual)
				? actual.some((value) => allowed.includes(value))
				: actual !== undefined && allowed.includes(actual as string | boolean);
		});
	}

	isOverdue(task: Task, fieldKey: string, today = new Date()): boolean {
		const field = this.definition(fieldKey);
		if (field.type !== "date" || !field.overdue_when) return false;
		const value = this.getField(task, fieldKey);
		return (
			typeof value === "string" &&
			value < relativeDay("today", today) &&
			this.conditionMatches(task, field.overdue_when)
		);
	}

	overdueFields(task: Task, today = new Date()): string[] {
		return Object.keys(this.schema.fields).filter((key) => this.isOverdue(task, key, today));
	}

	compare(key: string, a: FieldValue | undefined, b: FieldValue | undefined, enumOrder?: readonly string[]): number {
		const field = this.definition(key);
		if (a === undefined) return b === undefined ? 0 : 1;
		if (b === undefined) return -1;
		if (key === "id" && typeof a === "string" && typeof b === "string")
			return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
		if (field.type === "sequence" && typeof a === "string" && typeof b === "string") {
			const left = parseSequenceReference(a, field);
			const right = parseSequenceReference(b, field);
			if (left && right) {
				const prefixOrder = left.prefix.localeCompare(right.prefix);
				return prefixOrder || (left.number < right.number ? -1 : left.number > right.number ? 1 : 0);
			}
		}
		if (field.type === "enum" && typeof a === "string" && typeof b === "string") {
			const order = (value: string) => {
				const index = (enumOrder ?? field.values ?? []).indexOf(value);
				return index < 0 ? Number.POSITIVE_INFINITY : index;
			};
			const aOrder = order(a);
			const bOrder = order(b);
			return aOrder === bOrder ? a.localeCompare(b) : aOrder - bOrder;
		}
		if (typeof a === "number" && typeof b === "number") return a - b;
		return String(a).localeCompare(String(b));
	}

	format(key: string, value: FieldValue | undefined, mode: "plain" | "json"): FieldValue | string | null {
		this.definition(key);
		if (value === undefined) return mode === "json" ? null : "";
		if (mode === "json") return value;
		if (Array.isArray(value)) return value.join(", ");
		return String(value);
	}
}
