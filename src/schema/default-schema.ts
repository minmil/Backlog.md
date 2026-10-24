import { parse } from "yaml";
import defaultSchemaText from "./default-task-schema.yml" with { type: "text" };
import type { TaskSchema } from "./types.ts";

/** The shipped YAML is the single source for both init boilerplate and schema-less projects. */
export function getDefaultTaskSchemaText(): string {
	return defaultSchemaText;
}

export function getDefaultTaskSchema(): TaskSchema {
	return parse(defaultSchemaText) as TaskSchema;
}
