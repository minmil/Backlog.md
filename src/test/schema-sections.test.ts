import { afterEach, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { Core } from "../core/backlog.ts";
import {
	appendMarkdown,
	checklistAdd,
	checklistCheck,
	checklistRemove,
	checklistUncheck,
	logAppend,
	parseSections,
	serializeSections,
	setMarkdown,
} from "../markdown/sections.ts";
import { getDefaultTaskSchema } from "../schema/index.ts";
import {
	createUniqueTestDir,
	initializeFilesystemTestProject,
	safeCleanup,
	updateTestTaskSchema,
} from "./test-utils.ts";

function schema() {
	const result = structuredClone(getDefaultTaskSchema());
	result.users = [{ handle: "@alice", name: "Alice", default: true }];
	return result;
}

describe("schema section engine", () => {
	const createdDirectories: string[] = [];
	afterEach(async () => {
		for (const path of createdDirectories.splice(0)) await safeCleanup(path);
	});
	it("round-trips markdown, checklist and log with content outside markers unchanged", () => {
		const taskSchema = schema();
		const body = [
			"Intro with  spaces\n",
			"## Description\n\n<!-- SECTION:DESCRIPTION:BEGIN -->\n**Hello**\n<!-- SECTION:DESCRIPTION:END -->",
			"\n\nOther heading\n",
			"## Acceptance Criteria\n\n<!-- SECTION:ACCEPTANCE:BEGIN -->\n- [ ] #1 First\n- [x] #2 Second\n<!-- SECTION:ACCEPTANCE:END -->",
			"\n\n## Log\n\n<!-- SECTION:LOG:BEGIN -->\nauthor: @alice\ndate: 2026-10-23\ncreated: 2026-10-24T05:12:00.000Z\n---\nCalled client\n---\n<!-- SECTION:LOG:END -->\n",
		].join("");
		const parsed = parseSections(body, taskSchema);
		expect(parsed.sections.description).toBe("**Hello**");
		expect(parsed.sections.acceptance).toEqual([
			{ index: 1, text: "First", checked: false },
			{ index: 2, text: "Second", checked: true },
		]);
		expect(parsed.sections.log).toEqual([
			{
				author: "@alice",
				date: "2026-10-23",
				createdAt: "2026-10-24T05:12:00.000Z",
				body: "Called client",
			},
		]);
		expect(parsed.other).toBe("Intro with  spaces\n\n\nOther heading\n\n\n\n");
		expect(serializeSections(parsed, taskSchema)).toBe(body);
	});

	it("edits each kind and renumbers checklist items", () => {
		const taskSchema = schema();
		const parsed = parseSections("Preface  \n", taskSchema);
		setMarkdown(parsed, "description", "First", taskSchema);
		appendMarkdown(parsed, "description", "Second", taskSchema);
		checklistAdd(parsed, "acceptance", "One", taskSchema);
		checklistAdd(parsed, "acceptance", "Two", taskSchema);
		checklistAdd(parsed, "acceptance", "Three", taskSchema);
		checklistCheck(parsed, "acceptance", 3, taskSchema);
		checklistUncheck(parsed, "acceptance", 3, taskSchema);
		checklistRemove(parsed, "acceptance", 2, taskSchema);
		logAppend(
			parsed,
			"log",
			{ body: "Called client", date: "2026-10-23" },
			taskSchema,
			new Date("2026-10-24T05:12:00Z"),
		);
		const output = serializeSections(parsed, taskSchema);
		expect(output.startsWith("Preface  \n")).toBe(true);
		expect(output).toContain("First\n\nSecond");
		expect(output).toContain("- [ ] #1 One\n- [ ] #2 Three");
		expect(output).toContain("created: 2026-10-24T05:12:00.000Z");
		expect(parseSections(output, taskSchema).sections).toEqual(parsed.sections);
	});

	it("rejects unknown authors and delimiter lines, and preserves removed sections as other", () => {
		const taskSchema = schema();
		const parsed = parseSections("", taskSchema);
		expect(() => logAppend(parsed, "log", { author: "@other", body: "Hi" }, taskSchema)).toThrow("Unknown log author");
		expect(() => logAppend(parsed, "log", { body: "Hi\n---\nBye" }, taskSchema)).toThrow("standalone");
		setMarkdown(parsed, "description", "Text", taskSchema);
		const body = serializeSections(parsed, taskSchema);
		delete taskSchema.sections.description;
		const reloaded = parseSections(body, taskSchema);
		expect(reloaded.other).toBe(body);
		expect(serializeSections(reloaded, taskSchema)).toBe(body);
	});

	it("persists generic sections through core create and edit without changing other text", async () => {
		const path = createUniqueTestDir("schema-sections-core");
		createdDirectories.push(path);
		const core = new Core(path);
		await initializeFilesystemTestProject(core, "Sections");
		await updateTestTaskSchema(core.filesystem, (value) => {
			value.users = [{ handle: "@alice", name: "Alice", default: true }];
		});
		const created = await core.createTaskFromInput(
			{
				title: "Generic sections",
				rawContent: "Owner note with  spaces",
				sections: { description: "Initial description" },
			},
			false,
		);
		const updated = await core.updateTaskFromInput(
			created.task.id,
			{
				appendSections: { description: ["Second paragraph"] },
				addSectionItems: { acceptance: ["Confirm result"] },
				appendLog: { body: "Discussed with client", date: "2026-10-23" },
			},
			false,
		);
		if (!updated.filePath) throw new Error("Updated task has no file path");
		const content = await readFile(updated.filePath, "utf8");
		expect(content).toContain("Owner note with  spaces");
		expect(content).toContain("<!-- SECTION:DESCRIPTION:BEGIN -->");
		expect(content).toContain("Initial description\n\nSecond paragraph");
		expect(content).toContain("- [ ] #1 Confirm result");
		expect(content).toContain("author: @alice");
		const reloaded = await core.filesystem.loadTask(created.task.id);
		expect(reloaded?.sections?.description).toBe("Initial description\n\nSecond paragraph");
		expect(reloaded?.other).toContain("Owner note with  spaces");
	});
});
