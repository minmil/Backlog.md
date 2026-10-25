import type { TaskDetail } from "../core/task-detail.ts";
import { type LogEntry, parseSections, type ChecklistItem as SchemaChecklistItem } from "../markdown/sections.ts";
import { getDefaultTaskSchema } from "../schema/default-schema.ts";
import { FieldRegistry } from "../schema/field-registry.ts";
import type { Task } from "../types/index.ts";
import type { ChecklistItem } from "../ui/checklist.ts";
import { transformCodePathsPlain } from "../ui/code-path.ts";
import { formatStatusWithIcon } from "../ui/status-icon.ts";
import { sortByTaskId } from "../utils/task-sorting.ts";
import { formatUtcDateForDisplay, type UtcDateDisplayOptions } from "../utils/utc-date-display.ts";
import { formatDependencyGraphLines } from "./dependency-graph-text.ts";

export type TaskPlainTextOptions = {
	filePathOverride?: string;
	registry?: FieldRegistry;
};

export function formatDateForDisplay(dateStr: string, options: UtcDateDisplayOptions = {}): string {
	return formatUtcDateForDisplay(dateStr, options);
}

function buildChecklistItems(items: Task["acceptanceCriteriaItems"]): ChecklistItem[] {
	const criteria = items ?? [];
	return criteria
		.slice()
		.sort((a, b) => a.index - b.index)
		.map((criterion, index) => ({
			text: `#${index + 1} ${criterion.text}`,
			checked: criterion.checked,
		}));
}

export function buildAcceptanceCriteriaItems(task: Task): ChecklistItem[] {
	return buildChecklistItems(task.acceptanceCriteriaItems);
}

export function buildDefinitionOfDoneItems(task: Task): ChecklistItem[] {
	return buildChecklistItems(task.definitionOfDoneItems);
}

export function formatAcceptanceCriteriaLines(items: ChecklistItem[]): string[] {
	if (items.length === 0) return [];
	return items.map((item) => {
		const prefix = item.checked ? "- [x]" : "- [ ]";
		return `${prefix} ${transformCodePathsPlain(item.text)}`;
	});
}

function formatSubtaskLines(subtasks: Array<{ id: string; title: string }>): string[] {
	if (subtasks.length === 0) return [];
	const sorted = sortByTaskId(subtasks);
	return sorted.map((subtask) => `- ${subtask.id} - ${subtask.title}`);
}

/** The graph block task detail renders, with its heading, or no lines at all for an isolated task. */
function formatDependencyGraphBlock(task: TaskDetail): string[] {
	const graphLines = formatDependencyGraphLines(task.dependencyGraph);
	if (graphLines.length === 0) return [];
	return ["", "Dependency Graph:", "-".repeat(50), ...graphLines];
}

export function formatTaskPlainText(task: TaskDetail, options: TaskPlainTextOptions = {}): string {
	const lines: string[] = [];
	const registry = options.registry ?? new FieldRegistry(getDefaultTaskSchema());
	const filePath = options.filePathOverride ?? task.filePath;

	if (filePath) {
		lines.push(`File: ${filePath}`);
		lines.push("");
	}

	lines.push(`Task ${task.id} - ${task.title}`);
	lines.push("=".repeat(50));
	lines.push("");
	for (const [key, definition] of Object.entries(registry.schema.fields)) {
		if (definition.hidden || key === "id" || key === "title") continue;
		const value = registry.getField(task, key);
		if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) continue;
		const label = definition.label ?? key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
		const formatted =
			key === "status" && typeof value === "string"
				? `${formatStatusWithIcon(value)}${task.source === "archived" ? " (archived)" : ""}`
				: (key === "created_date" || key === "updated_date") && typeof value === "string"
					? formatDateForDisplay(value, { appendUtcLabel: true })
					: registry.format(key, value, "plain");
		lines.push(`${label}: ${formatted}${registry.isOverdue(task, key) ? " (overdue)" : ""}`);
	}

	const subtaskSummaries = task.subtaskSummaries ?? [];
	const subtaskCount = subtaskSummaries.length > 0 ? subtaskSummaries.length : (task.subtasks?.length ?? 0);
	if (subtaskCount > 0) {
		const subtaskLines = formatSubtaskLines(subtaskSummaries);
		if (subtaskLines.length > 0) {
			lines.push(`Subtasks (${subtaskCount}):`);
			lines.push(...subtaskLines);
		} else {
			lines.push(`Subtasks: ${subtaskCount}`);
		}
	}

	// Every plain task output is a detail read, so this replaces the raw dependency ID list entirely.
	lines.push(...formatDependencyGraphBlock(task));

	const body = parseSections(task.rawContent ?? "", registry.schema);
	for (const [id, definition] of Object.entries(registry.schema.sections)) {
		const value = task.sections?.[id] ?? body.sections[id];
		lines.push("", `${definition.title}:`, "-".repeat(50));
		if (definition.kind === "markdown") {
			lines.push(transformCodePathsPlain(String(value ?? "")));
		} else if (definition.kind === "checklist") {
			for (const [index, item] of ((value ?? []) as SchemaChecklistItem[]).entries()) {
				lines.push(`- [${item.checked ? "x" : " "}] #${index + 1} ${transformCodePathsPlain(item.text)}`);
			}
		} else {
			for (const entry of (value ?? []) as LogEntry[]) {
				lines.push(
					`${entry.author} — ${entry.date} (created ${formatDateForDisplay(entry.createdAt, { appendUtcLabel: true })})`,
				);
				if (entry.auto) lines.push("Automatic change");
				lines.push(transformCodePathsPlain(entry.body), "");
			}
		}
	}
	if (body.other.trim()) lines.push("", "Other:", "-".repeat(50), body.other);

	return lines.join("\n");
}

export function formatPlainTaskListFields(task: Task, names: string[], registry: FieldRegistry): string {
	return names
		.map(
			(name) =>
				`${name}=${registry.format(name, registry.getField(task, name), "plain")}${registry.isOverdue(task, name) ? " (overdue)" : ""}`,
		)
		.join(" ");
}
