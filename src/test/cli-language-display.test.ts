import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Core } from "../core/backlog.ts";
import { getTestCliPath } from "./test-cli.ts";
import {
	createUniqueTestDir,
	initializeFilesystemTestProject,
	safeCleanup,
	updateTestTaskSchema,
} from "./test-utils.ts";

const cli = getTestCliPath();
let directory: string;

async function run(args: string[], extraEnv: Record<string, string> = {}) {
	const child = Bun.spawn(["bun", cli, ...args], {
		cwd: directory,
		env: { ...process.env, ...extraEnv },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

beforeEach(async () => {
	directory = createUniqueTestDir("cli-language-display");
	const core = new Core(directory);
	await initializeFilesystemTestProject(core, "Language examples");
	await updateTestTaskSchema(core.filesystem, (schema) => {
		const title = schema.fields.title;
		const description = schema.sections.description;
		if (!title || !description) throw new Error("Default schema is incomplete");
		title.lang = "en";
		description.lang = "en";
		schema.fields.title_ja = { type: "text", label: "Title JA", lang: "ja", translation_of: "title" };
		schema.fields.title_fr = { type: "text", label: "Title FR", lang: "fr", translation_of: "title" };
		schema.sections.description_ja = {
			kind: "markdown",
			title: "Description JA",
			lang: "ja",
			translation_of: "description",
		};
	});
	await core.createTaskFromInput({
		title: "Alpha",
		fieldValues: { title_ja: "アルファ" },
		sections: { description: "English body", description_ja: "日本語の本文" },
	});
	await core.createTaskFromInput({ title: "Beta", sections: { description: "Second body" } });
});

afterEach(async () => {
	await safeCleanup(directory);
});

describe("CLI display language", () => {
	test("list, view and search add display JSON only with a selected language", async () => {
		const original = await run(["task", "list", "--json"]);
		expect(original.exitCode).toBe(0);
		expect(JSON.parse(original.stdout).tasks[0]).not.toHaveProperty("display");
		const list = await run(["task", "list", "--json", "--lang", "ja"]);
		expect(list.exitCode).toBe(0);
		const tasks = JSON.parse(list.stdout).tasks;
		expect(tasks.find((task: { title: string }) => task.title === "Alpha").display).toMatchObject({
			lang: "ja",
			title: "アルファ",
			fields: { title: "アルファ" },
		});
		expect(tasks.find((task: { title: string }) => task.title === "Beta").display.fallback).toContain("title");
		const view = await run(["task", "view", "TASK-1", "--json", "--lang", "ja"]);
		expect(view.exitCode).toBe(0);
		expect(JSON.parse(view.stdout).task.display.sections.description).toBe("日本語の本文");
		const search = await run(["search", "Alpha", "--json", "--lang", "ja"]);
		expect(search.exitCode).toBe(0);
		expect(
			JSON.parse(search.stdout).results.find((result: { type: string }) => result.type === "task").data.display.title,
		).toBe("アルファ");
		const translatedSearch = await run(["search", "アルファ", "--json", "--lang", "en"]);
		expect(
			JSON.parse(translatedSearch.stdout).results.find((result: { type: string }) => result.type === "task").data.title,
		).toBe("Alpha");
		const listSearch = await run(["task", "list", "--search", "アルファ", "--json", "--lang", "ja"]);
		expect(JSON.parse(listSearch.stdout).tasks.map((task: { title: string }) => task.title)).toEqual(["Alpha"]);
	});

	test("plain output shows fallback language and explicit member values", async () => {
		const list = await run(["task", "list", "--plain", "--lang", "ja", "--show-fields", "title,title_ja"]);
		expect(list.exitCode).toBe(0);
		expect(list.stdout).toContain("Beta [en]");
		expect(list.stdout).toContain("title=Beta [en] title_ja=");
		const view = await run(["task", "view", "TASK-2", "--plain", "--lang", "ja"]);
		expect(view.exitCode).toBe(0);
		expect(view.stdout).toContain("Task TASK-2 - Beta [en]");
		expect(view.stdout).toContain("Second body [en]");
		const direct = await run(["task", "TASK-1", "--json", "--lang", "ja"]);
		expect(JSON.parse(direct.stdout).task.display.title).toBe("アルファ");
	});

	test("draft reads and board export use the selected title", async () => {
		const core = new Core(directory);
		const created = await core.createTaskFromInput({
			title: "Draft example",
			status: "Draft",
			fieldValues: { title_ja: "下書き" },
		});
		const list = await run(["draft", "list", "--json", "--lang", "ja"]);
		expect(list.exitCode).toBe(0);
		expect(JSON.parse(list.stdout).drafts[0].display.title).toBe("下書き");
		const view = await run(["draft", "view", created.task.id, "--json", "--lang", "ja"]);
		expect(view.exitCode).toBe(0);
		expect(JSON.parse(view.stdout).draft.display.title).toBe("下書き");
		const exportResult = await run(["board", "export", "board-export.md", "--force", "--lang", "ja"]);
		expect(exportResult.exitCode).toBe(0);
		expect(await Bun.file(`${directory}/board-export.md`).text()).toContain("アルファ");
	});

	test("reports missing translations with and without a language filter", async () => {
		const all = await run(["i18n", "missing", "--json"]);
		expect(all.exitCode).toBe(0);
		const rows = JSON.parse(all.stdout);
		expect(rows.kind).toBe("i18n-missing");
		expect(rows.tasks.find((task: { id: string }) => task.id === "TASK-1").missing).toContainEqual({
			lang: "fr",
			key: "title",
			sourceValue: "Alpha",
		});
		const ja = await run(["i18n", "missing", "--lang", "ja", "--json"]);
		expect(ja.exitCode).toBe(0);
		expect(JSON.parse(ja.stdout).tasks.find((task: { id: string }) => task.id === "TASK-2").missing).toContainEqual({
			lang: "ja",
			key: "title",
			sourceValue: "Beta",
		});
		expect(JSON.parse(ja.stdout).tasks.find((task: { id: string }) => task.id === "TASK-1")).toBeUndefined();
	});

	test("rejects unsupported languages and honors BACKLOG_LANG", async () => {
		const invalid = await run(["task", "list", "--json", "--lang", "de"]);
		expect(invalid.exitCode).toBe(1);
		expect(invalid.stderr).toContain("Allowed languages: en, ja, fr");
		const fromEnvironment = await run(["task", "list", "--json"], { BACKLOG_LANG: "ja" });
		expect(fromEnvironment.exitCode).toBe(0);
		expect(JSON.parse(fromEnvironment.stdout).tasks[0].display.lang).toBe("ja");
	});
});
