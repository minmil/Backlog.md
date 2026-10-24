import { getDefaultTaskSchema } from "../schema/index.ts";
import type { TaskSchema } from "../schema/types.ts";
import type { Decision, Document, Task } from "../types/index.ts";
import { normalizeAssignee } from "../utils/assignee.ts";
import { stringifyFrontmatter } from "./frontmatter.ts";
import { parseSections, serializeSections } from "./sections.ts";
import { taskFrontmatter } from "./task-frontmatter.ts";

export function serializeTask(
	task: Task,
	originalContent = "",
	_legacySchema?: unknown,
	suppliedSchema?: TaskSchema,
): string {
	normalizeAssignee(task);
	const schema = suppliedSchema ?? getDefaultTaskSchema();
	const frontmatter: Record<string, unknown> = taskFrontmatter(task);
	for (const [name, definition] of Object.entries(schema.fields)) {
		if (!definition.core) frontmatter[name] = task.fieldValues?.[name];
	}

	const parsed = parseSections(task.rawContent ?? "", schema);
	if (task.sections) {
		for (const id of Object.keys(schema.sections)) {
			if (task.sections[id] !== undefined) parsed.sections[id] = task.sections[id];
		}
	}
	const contentBody = serializeSections(parsed, schema);
	const serialized = stringifyFrontmatter(contentBody, frontmatter, originalContent);
	return serialized.replace(/^(---\n(?:.*\n)*?---)\n(?!$)/, "$1\n\n");
}

export function serializeDecision(decision: Decision, originalContent = ""): string {
	const frontmatter = {
		id: decision.id,
		title: decision.title,
		date: decision.date,
		status: decision.status,
	};

	let content = `## Context\n\n${decision.context}\n\n`;
	content += `## Decision\n\n${decision.decision}\n\n`;
	content += `## Consequences\n\n${decision.consequences}`;

	if (decision.alternatives) {
		content += `\n\n## Alternatives\n\n${decision.alternatives}`;
	}

	return stringifyFrontmatter(content, frontmatter, originalContent);
}

export function serializeDocument(document: Document, originalContent = ""): string {
	const frontmatter = {
		id: document.id,
		title: document.title,
		type: document.type,
		created_date: document.createdDate,
		updated_date: document.updatedDate || undefined,
		tags: document.tags && document.tags.length > 0 ? document.tags : undefined,
	};

	return stringifyFrontmatter(document.rawContent, frontmatter, originalContent);
}
