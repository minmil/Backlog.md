import { realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
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
	const [tasks, drafts, docs, decisions, config, milestones, version] = await Promise.all([
		core.filesystem.listTasks(),
		core.filesystem.listDrafts(),
		core.filesystem.listDocuments(),
		core.filesystem.listDecisions(),
		core.filesystem.loadConfig(),
		core.filesystem.listMilestones(),
		getVersion(),
	]);
	const seen = new Set<string>();
	const root = await realpath(core.filesystem.rootDir);
	const assertLocalFile = async (label: string, filePath: string | undefined) => {
		if (!filePath) throw new Error(`Cannot export snapshot: missing path for ${label}`);
		const location = relative(root, await realpath(filePath));
		if (location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location)) {
			throw new Error(`Cannot export snapshot: ${label} resolves outside the project`);
		}
	};
	for (const task of tasks) {
		await assertLocalFile(`task ${task.id}`, task.filePath);
		const id = canonicalTaskId(task.id);
		if (seen.has(id)) throw new Error(`Cannot export snapshot: duplicate task ID ${task.id}`);
		seen.add(id);
	}
	for (const draft of drafts) await assertLocalFile(`draft ${draft.id}`, draft.filePath);
	for (const doc of docs)
		await assertLocalFile(`document ${doc.id}`, doc.path && join(core.filesystem.docsDir, doc.path));
	for (const decision of decisions)
		await assertLocalFile(
			`decision ${decision.id}`,
			decision.path && join(core.filesystem.decisionsDir, decision.path),
		);
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
		docs: docs.map((doc) => ({
			id: doc.id,
			title: doc.title,
			type: doc.type,
			createdDate: doc.createdDate,
			updatedDate: doc.updatedDate,
			rawContent: doc.rawContent,
			tags: doc.tags,
			path: doc.path,
		})),
		decisions: decisions.map((decision) => ({
			id: decision.id,
			title: decision.title,
			date: decision.date,
			status: decision.status,
			context: decision.context,
			decision: decision.decision,
			consequences: decision.consequences,
			alternatives: decision.alternatives,
			rawContent: decision.rawContent,
			path: decision.path,
		})),
		drafts: drafts.map((draft) => publishedTask(draft, schema, false)),
		tasks: tasks.map((task) => publishedTask(task, schema, false)),
		archivedTasks: [],
	};
}
