import type { TaskSchema } from "../schema/types.ts";
import type { Task } from "../types/index.ts";
import type { HtmlSnapshot } from "./html-snapshot.ts";

/** Keep only fields deliberately published in the standalone review file. */
export function publishedTask(task: Task, schema: TaskSchema, archived: boolean): Task {
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
