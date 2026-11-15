import type { TaskSchema } from "../schema/types.ts";
import type { Task } from "../types/index.ts";
import { isTerminalStatus } from "./terminal-status.ts";

function localDay(now = new Date()): string {
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Keep closure metadata in step with status changes on every task write path. */
export function applyStatusOutcome(task: Task, previous: Task | null, schema: TaskSchema, today = localDay()): void {
	const status = schema.fields.status;
	const outcomes = status?.outcomes;
	if (!status || !outcomes?.length) return;
	const values = { ...task.fieldValues };
	const terminal = isTerminalStatus(task.status, status.values ?? []);
	const wasTerminal = previous ? isTerminalStatus(previous.status, status.values ?? []) : false;
	if (!terminal) {
		delete values.outcome;
		delete values.outcome_date;
	} else {
		const chosen = values.outcome;
		if (chosen !== undefined && !outcomes.includes(String(chosen)))
			throw new Error(`Invalid outcome ${String(chosen)}. Expected one of: ${outcomes.join(", ")}`);
		if (!chosen) values.outcome = outcomes[0];
		if (status.outcome_date === true) {
			if (!wasTerminal) values.outcome_date = today;
		} else delete values.outcome_date;
	}
	task.fieldValues = values;
}
