import type { Task } from "../types/index.ts";

/** Built-in task metadata. These keys are reserved for the serializer. */
export function taskFrontmatter(task: Task) {
	return {
		id: task.id,
		title: task.title,
		status: task.status,
		assignee: task.assignee,
		reporter: task.reporter || undefined,
		created_date: task.createdDate,
		updated_date: task.updatedDate || undefined,
		due_date: task.dueDate || undefined,
		labels: task.labels,
		milestone: task.milestone || undefined,
		dependencies: task.dependencies,
		references: task.references?.length ? task.references : undefined,
		documentation: task.documentation?.length ? task.documentation : undefined,
		modified_files: task.modifiedFiles?.length ? task.modifiedFiles : undefined,
		parent_task_id: task.parentTaskId || undefined,
		subtasks: task.subtasks?.length ? task.subtasks : undefined,
		priority: task.priority || undefined,
		type: task.type || undefined,
		project: task.project || undefined,
		ordinal: task.ordinal,
		onStatusChange: task.onStatusChange || undefined,
	};
}
