import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { getTestCliPath } from "./test-cli.ts";
import { initializeFilesystemTestProject } from "./test-utils.ts";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function run(directory: string, args: string[]) {
	const result = Bun.spawnSync({
		cmd: [process.execPath, getTestCliPath(), ...args],
		cwd: directory,
		env: { ...process.env, BACKLOG_CWD: directory, CI: "true", TERM: "dumb" },
	});
	expect(result.exitCode, result.stderr.toString()).toBe(0);
	return JSON.parse(result.stdout.toString());
}

test("task list --overdue combines date rules with --where and emits JSON v2 arrays", async () => {
	const directory = mkdtempSync(join(tmpdir(), "backlog-overdue-"));
	directories.push(directory);
	const core = new Core(directory);
	await initializeFilesystemTestProject(core, "Overdue CLI");
	const schemaPath = join(directory, "backlog", "task-schema.yml");
	writeFileSync(
		schemaPath,
		readFileSync(schemaPath, "utf8")
			.replace(
				"due_date: {type: date, core: true, label: Due}",
				"due_date: {type: date, core: true, label: Due, overdue_when: {status: [To Do, In Progress]}}",
			)
			.replace("\nsections:", "\n  client_due: {type: date, overdue_when: {status: [To Do, In Progress]}}\nsections:"),
	);
	const yesterday = new Date();
	yesterday.setDate(yesterday.getDate() - 1);
	const day = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
	await core.createTaskFromInput({ title: "Internal late", dueDate: day });
	await core.createTaskFromInput({ title: "Client late", fieldValues: { client_due: day } });
	await core.createTaskFromInput({ title: "Finished", status: "Done", dueDate: day });
	const result = await run(directory, [
		"task",
		"list",
		"--overdue",
		"due_date",
		"--overdue",
		"client_due",
		"--where",
		"status=To Do",
		"--json",
	]);
	expect(result.schemaVersion).toBe(2);
	expect(result.tasks.map((task: { title: string }) => task.title)).toEqual(["Internal late", "Client late"]);
	expect(result.tasks.map((task: { overdue: string[] }) => task.overdue)).toEqual([["due_date"], ["client_due"]]);
});
