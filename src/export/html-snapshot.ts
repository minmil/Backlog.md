import { realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, sep } from "node:path";
import type { Core } from "../core/backlog.ts";
import type { TaskSchema } from "../schema/types.ts";
import type { Task } from "../types/index.ts";
import { canonicalTaskId } from "../utils/task-id.ts";
import { publishedTask } from "./html-snapshot-render.ts";

export const HTML_SNAPSHOT_VERSION = 1;

export { escapeEmbeddedJson, renderHtmlSnapshot } from "./html-snapshot-render.ts";

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
	/** Review proposals keyed by canonical task ID. Original tasks remain unchanged for later import. */
	proposedEdits?: Record<string, { task: Task; editedAt: string }>;
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
