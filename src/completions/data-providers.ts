import { type Core, createRuntimeCore } from "../core/backlog.ts";
import { getDefaultTaskSchema } from "../schema/default-schema.ts";

type CoreCallback<T> = (core: Core) => Promise<T>;

/**
 * Execute a callback with a Core instance, returning a fallback value if anything fails.
 */
async function withCore<T>(callback: CoreCallback<T>, fallback: T): Promise<T> {
	try {
		const core = await createRuntimeCore();
		return await callback(core);
	} catch {
		return fallback;
	}
}

function fieldValues(core: Core, key: "status" | "priority" | "type" | "project"): string[] {
	return [...(core.filesystem.taskSchema.fields[key]?.values ?? [])];
}

function defaultFieldValues(key: "status" | "priority" | "type" | "project"): string[] {
	return [...(getDefaultTaskSchema().fields[key]?.values ?? [])];
}

/**
 * Get the IDs of the tasks on the board
 */
export async function getTaskIds(): Promise<string[]> {
	return await withCore(async (core) => {
		const tasks = await core.filesystem.listTasks();
		return tasks.map((task) => task.id).sort();
	}, []);
}

/**
 * Get the IDs of the archived tasks, for the commands that act only on the archive
 */
export async function getArchivedTaskIds(): Promise<string[]> {
	return await withCore(async (core) => {
		const tasks = await core.filesystem.listArchivedTasks();
		return tasks.map((task) => task.id).sort();
	}, []);
}

/**
 * Get configured status values
 */
export async function getStatuses(): Promise<string[]> {
	return await withCore(async (core) => {
		return fieldValues(core, "status");
	}, defaultFieldValues("status"));
}

/**
 * Get priority values
 */
export async function getPriorities(): Promise<string[]> {
	return await withCore(async (core) => {
		return fieldValues(core, "priority");
	}, defaultFieldValues("priority"));
}

/**
 * Get configured task type values.
 */
export async function getTaskTypes(): Promise<string[]> {
	return await withCore(async (core) => {
		return fieldValues(core, "type");
	}, defaultFieldValues("type"));
}

/**
 * Get configured project values.
 */
export async function getProjects(): Promise<string[]> {
	return await withCore(async (core) => {
		return fieldValues(core, "project");
	}, []);
}

/**
 * Get unique labels from all tasks
 */
export async function getLabels(): Promise<string[]> {
	return await withCore(async (core) => {
		const tasks = await core.filesystem.listTasks();
		const labels = new Set<string>();
		for (const task of tasks) {
			for (const label of task.labels) {
				labels.add(label);
			}
		}
		return Array.from(labels).sort();
	}, []);
}

/**
 * Get unique assignees from all tasks
 */
export async function getAssignees(): Promise<string[]> {
	return await withCore(async (core) => {
		const tasks = await core.filesystem.listTasks();
		const assignees = new Set<string>();
		for (const task of tasks) {
			for (const assignee of task.assignee) {
				assignees.add(assignee);
			}
		}
		return Array.from(assignees).sort();
	}, []);
}

/**
 * Get the IDs of the documents in the docs folder
 */
export async function getDocumentIds(): Promise<string[]> {
	return await withCore(async (core) => {
		const docs = await core.filesystem.listDocuments();
		return docs.map((doc) => doc.id).sort();
	}, []);
}

/**
 * Get the IDs of the archived documents, for the commands that act only on the archive
 */
export async function getArchivedDocumentIds(): Promise<string[]> {
	return await withCore(async (core) => {
		const docs = await core.filesystem.listArchivedDocuments();
		return docs.map((doc) => doc.id).sort();
	}, []);
}
