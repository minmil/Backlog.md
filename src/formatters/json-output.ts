import { isAbsolute, join, relative } from "node:path";
import type { TaskDetail, TaskListItem } from "../core/task-detail.ts";
import { parseSections } from "../markdown/sections.ts";
import { FieldRegistry } from "../schema/field-registry.ts";
import { getDefaultTaskSchema } from "../schema/index.ts";
import type {
	Decision,
	DecisionSearchResult,
	Document,
	DocumentSearchResult,
	Task,
	TaskSearchResult,
} from "../types/index.ts";
import type { ListPage } from "../utils/list-window.ts";

type DocumentSummaryJson = {
	id: string;
	title: string;
	type: Document["type"];
	path: string | null;
	tags: string[];
	createdAt: string | null;
	updatedAt: string | null;
};

type DecisionSummaryJson = {
	id: string;
	title: string;
	status: Decision["status"];
	date: string | null;
};

type SearchResultJson =
	| { type: "task"; data: ReturnType<typeof toSchemaTaskJson> }
	| { type: "document"; data: DocumentSummaryJson }
	| { type: "decision"; data: DecisionSummaryJson };

function normalizePublicDate(value: string | undefined): string | null {
	if (!value) return null;
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

	const minutePrecision = value.match(/^(\d{4}-\d{2}-\d{2})(?:T|[ \t]+)(\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?[ \t]*Z?$/i);
	if (minutePrecision) {
		const [, date, time, seconds = "00"] = minutePrecision;
		return `${date}T${time}:${seconds}Z`;
	}

	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function toProjectRelativePath(projectRoot: string, filePath: string | undefined): string | null {
	if (!filePath) return null;
	const projectRelative = isAbsolute(filePath) ? relative(projectRoot, filePath) : filePath;
	return projectRelative.replaceAll("\\", "/");
}

function toDocumentSummaryJson(document: Document, projectRoot: string, docsDir: string): DocumentSummaryJson {
	return {
		id: document.id,
		title: document.title,
		type: document.type,
		path: document.path ? toProjectRelativePath(projectRoot, join(docsDir, document.path)) : null,
		tags: document.tags ?? [],
		createdAt: normalizePublicDate(document.createdDate),
		updatedAt: normalizePublicDate(document.updatedDate),
	};
}

function toDecisionSummaryJson(decision: Decision): DecisionSummaryJson {
	return {
		id: decision.id,
		title: decision.title,
		status: decision.status,
		date: normalizePublicDate(decision.date),
	};
}

/** A list cut by `--skip` or `--max-count` reports how many items matched and where the next window starts. */
function cutListJson(page: ListPage<unknown> | undefined): { total?: number; nextSkip?: number | null } {
	return page?.cut ? { total: page.total, nextSkip: page.nextSkip } : {};
}

function toSchemaTaskJson(task: Task, registry: FieldRegistry) {
	const fields = Object.fromEntries(
		Object.keys(registry.schema.fields).flatMap((key) => {
			const value = registry.getField(task, key);
			return value === undefined ? [] : [[key, registry.format(key, value, "json")]];
		}),
	);
	return { id: task.id, title: task.title, fields, unknownFields: task.unknownFields ?? {} };
}

export function taskListJson(
	tasks: TaskListItem[],
	page?: ListPage<unknown>,
	registry: FieldRegistry = new FieldRegistry(getDefaultTaskSchema()),
) {
	return {
		schemaVersion: 2,
		kind: "task-list" as const,
		tasks: tasks.map((task) => toSchemaTaskJson(task, registry)),
		...cutListJson(page),
	};
}

export function draftListJson(
	drafts: Task[],
	page?: ListPage<unknown>,
	registry: FieldRegistry = new FieldRegistry(getDefaultTaskSchema()),
) {
	return {
		schemaVersion: 2,
		kind: "draft-list" as const,
		drafts: drafts.map((draft) => toSchemaTaskJson(draft, registry)),
		...cutListJson(page),
	};
}

export function taskViewJson(
	task: TaskDetail,
	projectRoot: string,
	registry: FieldRegistry = new FieldRegistry(getDefaultTaskSchema()),
) {
	const body = parseSections(task.rawContent ?? "", registry.schema);
	return {
		schemaVersion: 2,
		kind: "task-view" as const,
		task: {
			...toSchemaTaskJson(task, registry),
			path: toProjectRelativePath(projectRoot, task.filePath),
			sections: body.sections,
			other: body.other,
		},
	};
}

export function draftViewJson(
	draft: TaskDetail,
	projectRoot: string,
	registry: FieldRegistry = new FieldRegistry(getDefaultTaskSchema()),
) {
	const body = parseSections(draft.rawContent ?? "", registry.schema);
	return {
		schemaVersion: 2,
		kind: "draft-view" as const,
		draft: {
			...toSchemaTaskJson(draft, registry),
			path: toProjectRelativePath(projectRoot, draft.filePath),
			sections: body.sections,
			other: body.other,
		},
	};
}

export function decisionListJson(decisions: Decision[], page?: ListPage<unknown>) {
	return {
		schemaVersion: 1,
		kind: "decision-list" as const,
		decisions: decisions.map(toDecisionSummaryJson),
		...cutListJson(page),
	};
}

/**
 * A search result set whose task records already carry readiness.
 *
 * The verdict travels on the record inside each result rather than being looked up by ID: two files
 * can claim one ID with different dependencies, and each claimant has to keep its own answer.
 */
export type SearchResultInput =
	| DocumentSearchResult
	| DecisionSearchResult
	| (Omit<TaskSearchResult, "task"> & {
			task: TaskListItem;
	  });

/** The search envelope for results the CLI already narrowed to printable ones, without tasks from other branches. */
export function searchJson(
	results: SearchResultInput[],
	projectRoot: string,
	docsDir: string,
	page?: ListPage<unknown>,
	registry: FieldRegistry = new FieldRegistry(getDefaultTaskSchema()),
) {
	const publicResults: SearchResultJson[] = [];
	for (const result of results) {
		if (result.type === "task") {
			publicResults.push({ type: "task", data: toSchemaTaskJson(result.task, registry) });
			continue;
		}
		if (result.type === "document") {
			publicResults.push({ type: "document", data: toDocumentSummaryJson(result.document, projectRoot, docsDir) });
			continue;
		}
		publicResults.push({ type: "decision", data: toDecisionSummaryJson(result.decision) });
	}
	return { schemaVersion: 2, kind: "search" as const, results: publicResults, ...cutListJson(page) };
}

export function formatJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

export function printJson(value: unknown): void {
	process.stdout.write(formatJson(value));
}
