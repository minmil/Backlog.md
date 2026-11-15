import { realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, sep } from "node:path";
import type { Core } from "../core/backlog.ts";
import type { TaskSchema } from "../schema/types.ts";
import type { Task } from "../types/index.ts";
import { canonicalTaskId } from "../utils/task-id.ts";

export const HTML_SNAPSHOT_VERSION = 1;

export interface HtmlSnapshot {
	formatVersion: typeof HTML_SNAPSHOT_VERSION;
	generatedAt: string;
	projectName: string;
	dateFormat?: string;
	taskCount: number;
	archivedTaskCount: number;
	schema: TaskSchema;
	tasks: Task[];
	archivedTasks: Task[];
}

/** A deliberate publication projection: no file paths, unknown YAML, commands, or config secrets. */
function publishedTask(task: Task, schema: TaskSchema, archived: boolean): Task {
	const fieldValues = Object.fromEntries(
		Object.entries(task.fieldValues ?? {}).filter(([key]) => Boolean(schema.fields[key])),
	);
	return {
		id: task.id,
		title: task.title,
		status: task.status,
		assignee: task.assignee,
		reporter: task.reporter,
		createdDate: task.createdDate,
		updatedDate: task.updatedDate,
		dueDate: task.dueDate,
		labels: task.labels,
		milestone: task.milestone,
		dependencies: task.dependencies,
		references: task.references,
		documentation: task.documentation,
		modifiedFiles: task.modifiedFiles,
		sections: task.sections,
		other: task.other,
		parentTaskId: task.parentTaskId,
		subtasks: task.subtasks,
		priority: task.priority,
		type: task.type,
		project: task.project,
		fieldValues,
		source: archived ? "archived" : "local",
	};
}

export async function createHtmlSnapshot(core: Core): Promise<HtmlSnapshot> {
	const [tasks, archivedTasks, config] = await Promise.all([
		core.filesystem.listTasks(),
		core.filesystem.listArchivedTasks(),
		core.filesystem.loadConfig(),
	]);
	const seen = new Set<string>();
	const root = await realpath(core.filesystem.rootDir);
	for (const task of [...tasks, ...archivedTasks]) {
		if (!task.filePath) throw new Error(`Cannot export snapshot: missing path for task ${task.id}`);
		const location = relative(root, await realpath(task.filePath));
		if (location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location)) {
			throw new Error(`Cannot export snapshot: task ${task.id} resolves outside the project`);
		}
		const id = canonicalTaskId(task.id);
		if (seen.has(id)) throw new Error(`Cannot export snapshot: duplicate task ID ${task.id}`);
		seen.add(id);
	}
	const schema = core.filesystem.taskSchema;
	return {
		formatVersion: HTML_SNAPSHOT_VERSION,
		generatedAt: new Date().toISOString(),
		projectName: config?.projectName || basename(core.filesystem.rootDir),
		dateFormat: config?.dateFormat,
		taskCount: tasks.length,
		archivedTaskCount: archivedTasks.length,
		schema,
		tasks: tasks.map((task) => publishedTask(task, schema, false)),
		archivedTasks: archivedTasks.map((task) => publishedTask(task, schema, true)),
	};
}

export function escapeEmbeddedJson(value: unknown): string {
	return JSON.stringify(value)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/&/g, "\\u0026")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderHtmlSnapshot(snapshot: HtmlSnapshot, javascript: string, css: string): string {
	const title = escapeHtml(snapshot.projectName);
	// The CSP blocks all network traffic and external assets, including Markdown image URLs.
	return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">\n<title>${title} · Backlog snapshot</title>\n<style>${css.replace(/<\/style/gi, "<\\/style")}</style>\n</head>\n<body>\n<div id="root"></div>\n<script type="application/json" id="backlog-snapshot">${escapeEmbeddedJson(snapshot)}</script>\n<script>${javascript.replace(/<\/script/gi, "<\\/script")}</script>\n</body>\n</html>\n`;
}
