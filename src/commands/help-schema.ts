import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Command } from "commander";
import { getDefaultTaskSchema, loadTaskSchema } from "../schema/index.ts";
import { resolveBacklogDirectory } from "../utils/backlog-directory.ts";
import { BACKLOG_CWD_ENV } from "../utils/runtime-cwd.ts";

export interface HelpField {
	name: string;
	type: string | (() => string);
	description?: string | (() => string);
}

export interface HelpSchema {
	reads?: string;
	writes?: string;
	required?: HelpField[];
	optional?: HelpField[];
	output?: string;
	examples?: string[];
}

function resolveText(value: string | (() => string) | undefined): string | undefined {
	return typeof value === "function" ? value() : value;
}

function formatField(field: HelpField): string {
	const type = resolveText(field.type) ?? "";
	const description = resolveText(field.description);
	const suffix = description ? ` - ${description}` : "";
	return `  - ${field.name}: ${type}${suffix}`;
}

function formatFields(title: string, fields: HelpField[] | undefined): string[] {
	if (!fields || fields.length === 0) {
		return [title, "  - None"];
	}
	return [title, ...fields.map(formatField)];
}

function firstMarkdownField(schema: HelpSchema): string | undefined {
	const fields = [...(schema.required ?? []), ...(schema.optional ?? [])];
	return fields.find((field) => resolveText(field.type) === "Markdown")?.name;
}

function renderHelpSchema(schema: HelpSchema): string {
	const lines = ["", "Input schema:", ...formatFields("Required fields:", schema.required)];

	if (schema.optional) {
		lines.push(...formatFields("Optional fields:", schema.optional));
	}
	const markdownField = firstMarkdownField(schema);
	if (markdownField) {
		lines.push(
			"Markdown fields:",
			"  - Multi-line values need real newlines; a literal \\n is stored as text",
			`  - Example (bash/zsh): --${markdownField} $'First line\\nSecond line'`,
		);
	}
	if (schema.reads) {
		lines.push("Reads:", `  - ${schema.reads}`);
	}
	if (schema.writes) {
		lines.push("Writes:", `  - ${schema.writes}`);
	}
	if (schema.output) {
		lines.push("Output:", `  - ${schema.output}`);
	}
	if (schema.examples && schema.examples.length > 0) {
		lines.push("Examples:", ...schema.examples.map((example) => `  ${renderConfiguredTaskIds(example)}`));
	}

	return `\n${lines.join("\n")}\n`;
}

export function addHelpSchema(command: Command, schema: HelpSchema): Command {
	return command.addHelpText("after", () => renderHelpSchema(schema));
}

function stripYamlScalar(value: string): string {
	return value
		.trim()
		.replace(/^['"]|['"]$/g, "")
		.trim();
}

function parseStringValueFromConfig(content: string, keys: string[]): string | null {
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) {
			continue;
		}
		const colonIndex = line.indexOf(":");
		if (colonIndex === -1) {
			continue;
		}
		const key = line.slice(0, colonIndex).trim();
		if (!keys.includes(key)) {
			continue;
		}
		const value = stripYamlScalar(line.slice(colonIndex + 1));
		return value || null;
	}
	return null;
}

function findBacklogConfigPathSync(startDir: string): string | null {
	let current = startDir;
	while (current !== dirname(current)) {
		const resolution = resolveBacklogDirectory(current);
		if (resolution.configPath) {
			return resolution.configPath;
		}
		current = dirname(current);
	}
	return null;
}

function getRuntimeConfigStartDir(): string {
	const override = process.env[BACKLOG_CWD_ENV]?.trim();
	return override ? resolve(override) : process.cwd();
}

function configuredFieldValues(key: "status" | "priority" | "type" | "project"): string[] {
	const configPath = findBacklogConfigPathSync(getRuntimeConfigStartDir());
	if (configPath) {
		let current = getRuntimeConfigStartDir();
		while (current !== dirname(current)) {
			const resolution = resolveBacklogDirectory(current);
			if (resolution.configPath === configPath && resolution.backlogPath) {
				try {
					return [...(loadTaskSchema(resolution.backlogPath, configPath).fields[key]?.values ?? [])];
				} catch {
					break;
				}
			}
			current = dirname(current);
		}
	}
	return [...(getDefaultTaskSchema().fields[key]?.values ?? [])];
}

function includeDraftStatus(statuses: string[]): string[] {
	const normalizedStatuses = normalizeStatusValues(statuses);
	const hasDraft = normalizedStatuses.some((status) => status.toLowerCase() === "draft");
	return hasDraft ? normalizedStatuses : ["Draft", ...normalizedStatuses];
}

function normalizeStatusValues(statuses: string[]): string[] {
	return statuses.map((status) => status.trim()).filter(Boolean);
}

export function getCliStatusValues(options?: { includeDraft?: boolean }): string[] {
	const normalizedStatuses = normalizeStatusValues(configuredFieldValues("status"));
	return options?.includeDraft ? includeDraftStatus(normalizedStatuses) : normalizedStatuses;
}

export function getCliPriorityValues(): string[] {
	return configuredFieldValues("priority");
}

export function getCliTaskTypeValues(): string[] {
	return configuredFieldValues("type");
}

export function getCliProjectValues(): string[] {
	return configuredFieldValues("project");
}

export function getCliTaskPrefix(): string {
	const configPath = findBacklogConfigPathSync(getRuntimeConfigStartDir());
	if (configPath) {
		try {
			return parseStringValueFromConfig(readFileSync(configPath, "utf8"), ["task_prefix", "taskPrefix"]) ?? "task";
		} catch {
			return "task";
		}
	}
	return "task";
}

export function taskIdExample(body: string): string {
	return `${getCliTaskPrefix().toUpperCase()}-${body}`;
}

export function renderConfiguredTaskIds(text: string): string {
	const taskTypes = getCliTaskTypeValues();
	return text
		.replace(/\{\{TASK_TYPE:(\d+)\}\}/g, (_match, index: string) => {
			return JSON.stringify(taskTypes[Number(index) - 1] ?? "<configured task type>");
		})
		.replace(/\{\{TASK_ID:(\d+(?:\.\d+)*)\}\}/g, (_match, body: string) => taskIdExample(body))
		.replace(/\b(?:BACK|TASK)-(\d+(?:\.\d+)*)\b/g, (_match, body: string) => taskIdExample(body));
}

export function choiceType(values: readonly string[], options?: { multiple?: boolean }): string {
	return `${options?.multiple ? "one or more of" : "one of"}: ${values.join(", ")}`;
}

export function statusType(options?: { includeDraft?: boolean; multiple?: boolean }): string {
	const cardinality = options?.multiple ? "one or more of" : "one of";
	return `${cardinality} configured statuses: ${getCliStatusValues(options).join(", ")}`;
}

export function priorityType(): string {
	return `one of configured priorities: ${getCliPriorityValues().join(", ")}`;
}

export function taskType(options?: { multiple?: boolean }): string {
	const cardinality = options?.multiple ? "one or more of" : "one of";
	return `${cardinality} configured task types: ${getCliTaskTypeValues().join(", ")}`;
}

export function projectType(options?: { multiple?: boolean }): string {
	const values = getCliProjectValues();
	if (values.length === 0) {
		return "no projects configured; add values to task-schema.yml fields.project.values";
	}
	const cardinality = options?.multiple ? "one or more of" : "one of";
	return `${cardinality} configured projects: ${values.join(", ")}`;
}
