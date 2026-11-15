import { realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, sep } from "node:path";
import type { Core } from "../core/backlog.ts";
import type { TaskSchema } from "../schema/types.ts";
import type { BacklogConfig, Decision, Document, Milestone, Task } from "../types/index.ts";
import { canonicalTaskId } from "../utils/task-id.ts";
import { getVersion } from "../utils/version.ts";
import { publishedTask } from "./html-snapshot-render.ts";

export const HTML_SNAPSHOT_VERSION = 2;

export { escapeEmbeddedJson, renderHtmlSnapshot } from "./html-snapshot-render.ts";

export interface HtmlSnapshot {
	formatVersion: typeof HTML_SNAPSHOT_VERSION;
	generatedAt: string;
	version?: string;
	projectName: string;
	dateFormat?: string;
	taskCount: number;
	archivedTaskCount: number;
	schema: TaskSchema;
	config?: BacklogConfig;
	milestones?: Milestone[];
	archivedMilestones?: Milestone[];
	docs?: Document[];
	decisions?: Decision[];
	drafts?: Task[];
	tasks: Task[];
	archivedTasks: Task[];
	/** Review proposals keyed by canonical task ID. Original tasks remain unchanged for later import. */
	proposedEdits?: Record<string, { task: Task | null; editedAt: string }>;
}

export async function createHtmlSnapshot(core: Core): Promise<HtmlSnapshot> {
	const [tasks, config, milestones, version] = await Promise.all([
		core.filesystem.listTasks(),
		core.filesystem.loadConfig(),
		core.filesystem.listMilestones(),
		getVersion(),
	]);
	const seen = new Set<string>();
	const root = await realpath(core.filesystem.rootDir);
	for (const task of tasks) {
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
		version,
		projectName: config?.projectName || basename(core.filesystem.rootDir),
		dateFormat: config?.dateFormat,
		taskCount: tasks.length,
		archivedTaskCount: 0,
		schema,
		config: {
			projectName: config?.projectName || basename(core.filesystem.rootDir),
			statuses: config?.statuses?.length ? config.statuses : (schema.fields.status?.values ?? []),
			labels: config?.labels ?? [],
			dateFormat: config?.dateFormat ?? "YYYY-MM-DD",
			types: config?.types,
			priorities: config?.priorities,
			projects: config?.projects,
			defaultAssignee: config?.defaultAssignee,
			definitionOfDone: config?.definitionOfDone,
			defaultStatus: config?.defaultStatus,
			hideEmptyColumns: config?.hideEmptyColumns,
			prefixes: config?.prefixes,
		},
		milestones,
		tasks: tasks.map((task) => publishedTask(task, schema, false)),
		archivedTasks: [],
	};
}
