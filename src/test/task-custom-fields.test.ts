import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { parseTask } from "../markdown/parser.ts";
import { serializeTask } from "../markdown/serializer.ts";
import { loadCustomFieldSchema } from "../utils/custom-fields.ts";
import { createTestDirOutsideRepository, safeCleanup } from "./test-utils.ts";

const FIELDS = `fields:
  client_facing:
    type: bool
    default: false
  tech_action:
    type: enum
    values: [Pending Triage, Configuring, Testing]
  prod_date:
    type: date
  title_ja:
    type: text
`;

let root: string;
let core: Core;

beforeEach(async () => {
	root = await createTestDirOutsideRepository("task-custom-fields");
	core = new Core(root);
	await core.filesystem.ensureBacklogStructure();
	await core.filesystem.saveConfig({
		projectName: "Custom fields",
		statuses: ["To Do", "In Progress", "Done"],
		labels: [],
		dateFormat: "YYYY-MM-DD",
		filesystemOnly: true,
		remoteOperations: false,
		autoCommit: false,
	});
	await Bun.write(join(core.filesystem.backlogDir, "fields.yml"), FIELDS);
});

afterEach(async () => {
	core.disposeContentStore();
	core.disposeSearchService();
	await safeCleanup(root);
});

describe("task custom fields", () => {
	it("parses declared values, warns once for invalid values, and ignores undeclared values", () => {
		const schema = loadCustomFieldSchema(core.filesystem.backlogDir);
		const warning = spyOn(console, "error").mockImplementation(() => {});
		try {
			const task = parseTask(
				`---
id: TASK-1
title: Sample
status: To Do
created_date: '2026-10-22'
client_facing: yes
tech_action: Nonsense
prod_date: '2026-10-23'
title_ja: テスト
outside: kept
---
`,
				schema,
			);
			expect(task.customFields).toEqual({
				client_facing: true,
				tech_action: "Nonsense",
				prod_date: "2026-10-23",
				title_ja: "テスト",
			});
			expect(task.customFields).not.toHaveProperty("outside");
			expect(warning).toHaveBeenCalledTimes(1);
			expect(warning.mock.calls[0]?.[0]).toContain("tech_action");
		} finally {
			warning.mockRestore();
		}
	});

	it("round-trips every field type and preserves unknown metadata", () => {
		const schema = core.filesystem.customFieldSchema;
		const task = parseTask(
			`---
id: TASK-1
title: Sample
status: To Do
created_date: '2026-10-22'
client_facing: false
tech_action: Testing
prod_date: '2026-10-23'
title_ja: テスト
outside: keep me
---
`,
			schema,
		);
		const output = serializeTask(
			task,
			`---
id: TASK-1
title: Sample
status: To Do
created_date: '2026-10-22'
client_facing: false
tech_action: Testing
prod_date: '2026-10-23'
title_ja: テスト
outside: keep me
---
`,
			schema,
		);
		expect(output).toContain("client_facing: false");
		expect(output).toContain("tech_action: Testing");
		expect(output).toContain("prod_date: '2026-10-23'");
		expect(output).toContain("outside: keep me");
		expect(parseTask(output, schema).customFields).toEqual(task.customFields);
	});

	it("applies defaults on create, canonicalizes edits, and leaves stored values intact on status changes", async () => {
		const { task, filePath } = await core.createTaskFromInput({
			title: "Sample",
			customFields: { tech_action: "testing", prod_date: "2026-10-23", title_ja: "テスト" },
		});
		const path = filePath as string;
		expect(task.customFields).toEqual({
			client_facing: false,
			tech_action: "Testing",
			prod_date: "2026-10-23",
			title_ja: "テスト",
		});
		const before = await Bun.file(path).text();
		await core.updateTaskFromInput(task.id, { status: "In Progress" }, false);
		const after = await Bun.file(path).text();
		const fieldLines = (source: string) => source.match(/^(client_facing|tech_action|prod_date|title_ja):.*$/gm);
		expect(fieldLines(after)).toEqual(fieldLines(before));

		await core.updateTaskFromInput(task.id, { customFields: { tech_action: "configuring" } }, false);
		expect((await core.filesystem.loadTask(task.id))?.customFields?.tech_action).toBe("Configuring");
	});

	it("rejects bad writes without changing the file and clears declared fields", async () => {
		const { task, filePath } = await core.createTaskFromInput({
			title: "Sample",
			customFields: { tech_action: "Testing" },
		});
		const path = filePath as string;
		const before = await Bun.file(path).text();
		await expect(
			core.updateTaskFromInput(task.id, { customFields: { tech_action: "Nonsense" } }, false),
		).rejects.toThrow("Pending Triage, Configuring, Testing");
		expect(await Bun.file(path).text()).toBe(before);
		await core.updateTaskFromInput(task.id, { clearCustomFields: ["tech_action"] }, false);
		expect(await Bun.file(path).text()).not.toContain("tech_action:");
	});

	it("preserves a value when its field is removed from the schema", async () => {
		const { task, filePath } = await core.createTaskFromInput({
			title: "Sample",
			customFields: { tech_action: "Testing" },
		});
		await Bun.write(join(core.filesystem.backlogDir, "fields.yml"), "fields:\n  client_facing:\n    type: bool\n");
		await core.updateTaskFromInput(task.id, { status: "In Progress" }, false);
		expect(await Bun.file(filePath as string).text()).toContain("tech_action: Testing");
		expect((await core.filesystem.loadTask(task.id))?.customFields?.tech_action).toBeUndefined();
	});
});
