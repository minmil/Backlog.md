export const FIELD_TYPES = [
	"id",
	"text",
	"bool",
	"date",
	"datetime",
	"enum",
	"multi-enum",
	"string-list",
	"user",
	"user-list",
	"task-ref",
	"task-ref-list",
	"milestone-ref",
	"number",
	"sequence",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];
export type SectionKind = "markdown" | "checklist" | "log";
export type SchemaCondition = Record<string, string | boolean | Array<string | boolean>>;

export interface SchemaUser {
	handle: string;
	name: string;
	default?: boolean;
}

export interface SchemaField {
	type: FieldType;
	label?: string;
	description?: string;
	core?: boolean;
	managed?: boolean;
	hidden?: boolean;
	required?: boolean;
	default?: unknown;
	values?: string[];
	lang?: string;
	translation_of?: string;
	track_changes?: boolean;
	overdue_when?: SchemaCondition;
	scope?: string;
	prefixes?: Record<string, string>;
	pad?: number;
	assign_when?: SchemaCondition;
}

export interface SchemaSection {
	kind: SectionKind;
	title: string;
	description?: string;
	lang?: string;
	translation_of?: string;
	required?: boolean;
}

export interface TaskSchema {
	users: SchemaUser[];
	fields: Record<string, SchemaField>;
	sections: Record<string, SchemaSection>;
	ui: {
		board: { card: string[]; filters: string[] };
		task_list: { columns: string[]; filters: string[] };
		milestones: { row: string[] };
		detail: { order: string[] };
	};
}

export interface SchemaIssue {
	key: string;
	message: string;
}

export class TaskSchemaError extends Error {
	constructor(
		readonly issues: SchemaIssue[],
		readonly path?: string,
	) {
		super(
			`${path ? `${path}: ` : ""}Invalid task schema:\n${issues.map((issue) => `- ${issue.key}: ${issue.message}`).join("\n")}`,
		);
		this.name = "TaskSchemaError";
	}
}
