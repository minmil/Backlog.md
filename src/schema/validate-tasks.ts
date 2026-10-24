import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMarkdown } from "../markdown/parser.ts";
import type { SchemaIssue, TaskSchema } from "./types.ts";

function markdownFiles(directory: string): string[] {
	let entries: Dirent[];
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
		throw error;
	}
	return entries.flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return markdownFiles(path);
		return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
	});
}

function isPresent(value: unknown): boolean {
	return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
}

function validDate(value: unknown): boolean {
	if (value instanceof Date) return !Number.isNaN(value.getTime());
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function valueIssue(type: string, value: unknown, values: string[] | undefined, users: Set<string>): string | null {
	const strings = (item: unknown): item is string[] =>
		Array.isArray(item) && item.every((entry) => typeof entry === "string");
	const user = (item: unknown) =>
		typeof item === "string" && /^@[A-Za-z0-9._-]+$/.test(item) && (users.size === 0 || users.has(item));
	switch (type) {
		case "id":
		case "text":
		case "task-ref":
		case "milestone-ref":
			return typeof value === "string" ? null : "Expected text";
		case "bool":
			return typeof value === "boolean" ? null : "Expected a boolean";
		case "number":
			return typeof value === "number" && Number.isFinite(value) ? null : "Expected a number";
		case "date":
			return validDate(value) ? null : "Expected YYYY-MM-DD";
		case "datetime":
			return (value instanceof Date && !Number.isNaN(value.getTime())) ||
				(typeof value === "string" &&
					(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value) ||
						/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)))
				? null
				: "Expected a date and time";
		case "enum":
			return typeof value === "string" && (values ?? []).some((entry) => entry.toLowerCase() === value.toLowerCase())
				? null
				: `Expected one of: ${(values ?? []).join(", ")}`;
		case "multi-enum":
			return strings(value) &&
				value.every((entry) => (values ?? []).some((option) => option.toLowerCase() === entry.toLowerCase()))
				? null
				: `Expected a list drawn from: ${(values ?? []).join(", ")}`;
		case "string-list":
		case "task-ref-list":
			return strings(value) ? null : "Expected a list of text values";
		case "user":
			return user(value) ? null : `Expected a configured user handle${users.size ? `: ${[...users].join(", ")}` : ""}`;
		case "user-list":
			return Array.isArray(value) && value.every(user)
				? null
				: `Expected a list of configured user handles${users.size ? `: ${[...users].join(", ")}` : ""}`;
		default:
			return `Unknown field type ${type}`;
	}
}

export function validateTaskFiles(backlogDir: string, schema: TaskSchema): SchemaIssue[] {
	const issues: SchemaIssue[] = [];
	const taskPaths = ["tasks", "drafts", "archive/tasks", "archive/drafts", "completed"].flatMap((name) =>
		markdownFiles(join(backlogDir, name)),
	);
	const milestonePaths = ["milestones", "archive/milestones"].flatMap((name) => markdownFiles(join(backlogDir, name)));
	const milestones = new Set<string>();
	for (const path of milestonePaths) {
		try {
			const id = parseMarkdown(readFileSync(path, "utf8")).frontmatter.id;
			if (typeof id === "string") milestones.add(id);
		} catch (error) {
			issues.push({
				key: path,
				message: `Cannot read milestone: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}
	const tasks: Array<{ path: string; data: Record<string, unknown> }> = [];
	for (const path of taskPaths) {
		try {
			tasks.push({ path, data: parseMarkdown(readFileSync(path, "utf8")).frontmatter });
		} catch (error) {
			issues.push({
				key: path,
				message: `Cannot read task: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}
	const ids = new Set(tasks.map(({ data }) => data.id).filter((id): id is string => typeof id === "string"));
	const users = new Set(schema.users.map((user) => user.handle));
	const references = new Map<string, string[]>();
	for (const { path, data } of tasks) {
		const taskRefs: string[] = [];
		for (const [key, field] of Object.entries(schema.fields)) {
			if (key === "branch") continue;
			const value = data[key];
			if (!isPresent(value)) {
				if (field.required) issues.push({ key: `${path}:${key}`, message: "Required value is missing" });
				continue;
			}
			const problem = valueIssue(field.type, value, field.values, users);
			if (problem) issues.push({ key: `${path}:${key}`, message: problem });
			const refs =
				field.type === "task-ref" ? [value] : field.type === "task-ref-list" && Array.isArray(value) ? value : [];
			for (const ref of refs) {
				if (typeof ref === "string" && !ids.has(ref))
					issues.push({ key: `${path}:${key}`, message: `Task ${ref} does not exist` });
				else if (typeof ref === "string" && key !== "subtasks") taskRefs.push(ref);
			}
			if (field.type === "milestone-ref" && typeof value === "string" && !milestones.has(value)) {
				issues.push({ key: `${path}:${key}`, message: `Milestone ${value} does not exist` });
			}
		}
		if (typeof data.id === "string") references.set(data.id, taskRefs);
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string): void => {
		if (visited.has(id)) return;
		visiting.add(id);
		for (const ref of references.get(id) ?? []) {
			if (visiting.has(ref)) issues.push({ key: id, message: `Task reference cycle includes ${ref}` });
			else visit(ref);
		}
		visiting.delete(id);
		visited.add(id);
	};
	for (const id of references.keys()) visit(id);
	return issues;
}
