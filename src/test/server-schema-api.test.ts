import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Core } from "../core/backlog.ts";
import type { ContentStore } from "../core/content-store.ts";
import { BacklogServer } from "../server/index.ts";
import {
	createUniqueTestDir,
	initializeFilesystemTestProject,
	retry,
	safeCleanup,
	updateTestTaskSchema,
} from "./test-utils.ts";

describe("schema task API", () => {
	let directory: string;
	let core: Core;
	let server: BacklogServer;
	let baseUrl: string;

	beforeEach(async () => {
		directory = createUniqueTestDir("server-schema-api");
		core = new Core(directory);
		await initializeFilesystemTestProject(core, "Schema API");
		await updateTestTaskSchema(core.filesystem, (schema) => {
			schema.users = [{ handle: "@alice", name: "Alice", default: true }];
			const title = schema.fields.title;
			const description = schema.sections.description;
			if (!title || !description) throw new Error("Default schema is incomplete");
			title.lang = "en";
			description.lang = "en";
			schema.fields.title_ja = { type: "text", label: "Title (JA)", lang: "ja", translation_of: "title" };
			schema.sections.description_ja = {
				kind: "markdown",
				title: "Description (JA)",
				lang: "ja",
				translation_of: "description",
			};
			schema.fields.side = { type: "enum", values: ["Buyer", "Seller"], label: "Side" };
			schema.fields.due_date = { ...schema.fields.due_date!, overdue_when: { status: ["To Do", "In Progress"] } };
		});
		server = new BacklogServer(directory);
		await server.start(0, false);
		baseUrl = `http://127.0.0.1:${server.getPort()}`;
	});

	it("returns translated display projections and rejects unsupported languages", async () => {
		const schema = await (await fetch(`${baseUrl}/api/schema`)).json();
		expect(schema.displayLanguages).toEqual(["en", "ja"]);
		expect(schema.defaultLanguage).toBe("en");
		const response = await fetch(`${baseUrl}/api/tasks`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Example task",
				fields: { title_ja: "例のタスク" },
				sections: { description: "English body", description_ja: "日本語の本文" },
			}),
		});
		expect(response.status).toBe(201);
		const created = await response.json();
		const list = await (await fetch(`${baseUrl}/api/tasks?lang=ja`)).json();
		expect(list.find((item: { id: string }) => item.id === created.id).display).toMatchObject({
			lang: "ja",
			title: "例のタスク",
			fields: { title: "例のタスク" },
			fallback: [],
		});
		const view = await (await fetch(`${baseUrl}/api/tasks/${created.id}?lang=ja`)).json();
		expect(view.display.sections.description).toBe("日本語の本文");
		const search = await (await fetch(`${baseUrl}/api/search?query=Example&types=task&lang=ja`)).json();
		expect(search.find((item: { type: string }) => item.type === "task").task.display.title).toBe("例のタスク");
		for (const path of ["/api/tasks", `/api/tasks/${created.id}`, "/api/search"]) {
			const invalid = await fetch(`${baseUrl}${path}?lang=de`);
			expect(invalid.status).toBe(400);
			expect((await invalid.json()).allowedLanguages).toEqual(["en", "ja"]);
		}
	});

	it("returns overdue arrays and filters the task API by an overdue date field", async () => {
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);
		const day = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
		const create = (title: string, status: string) =>
			fetch(`${baseUrl}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title, fields: { status, due_date: day } }),
			});
		expect((await create("Late", "To Do")).status).toBe(201);
		expect((await create("Finished", "Done")).status).toBe(201);
		const all = await (await fetch(`${baseUrl}/api/tasks`)).json();
		expect(all.find((task: { title: string }) => task.title === "Late").overdue).toEqual(["due_date"]);
		expect(all.find((task: { title: string }) => task.title === "Finished").overdue).toEqual([]);
		const overdue = await (await fetch(`${baseUrl}/api/tasks?overdue=due_date`)).json();
		expect(overdue.map((task: { title: string }) => task.title)).toEqual(["Late"]);
		expect((await fetch(`${baseUrl}/api/tasks?overdue=unknown`)).status).toBe(400);
	});

	afterEach(async () => {
		await server.stop();
		core.disposeContentStore();
		await safeCleanup(directory);
	});

	it("returns the configured schema and schema-shaped task responses", async () => {
		const schemaResponse = await fetch(`${baseUrl}/api/schema`);
		expect(schemaResponse.status).toBe(200);
		const schema = await schemaResponse.json();
		expect(schema).toMatchObject({
			schemaVersion: 2,
			kind: "schema",
			fields: { side: { values: ["Buyer", "Seller"] } },
		});

		const createResponse = await fetch(`${baseUrl}/api/tasks`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Schema task",
				fields: { status: "In Progress", side: "buyer" },
				sections: { description: "Schema description" },
				checklist: [{ section: "acceptance", op: "add", text: "Ready" }],
				log: { section: "log", body: "Created through API", author: "@alice", date: "2026-10-25" },
			}),
		});
		expect(createResponse.status).toBe(201);
		const created = await createResponse.json();
		expect(created.fields).toMatchObject({ status: "In Progress", side: "Buyer" });
		expect(created.sections.description).toBe("Schema description");
		expect(created.sections.acceptance[0]).toMatchObject({ index: 1, text: "Ready", checked: false });
		expect(created.sections.log[0]).toMatchObject({ author: "@alice", body: "Created through API" });
		expect(created.other.trim()).toBe("");

		const view = await (await fetch(`${baseUrl}/api/tasks/${created.id}`)).json();
		expect(view.fields.side).toBe("Buyer");
		expect(view.sections.description).toBe("Schema description");
		const search = await (await fetch(`${baseUrl}/api/search?types=task&query=Schema%20task`)).json();
		expect(search.find((result: { type: string }) => result.type === "task").task.fields.side).toBe("Buyer");
		await core.createTaskFromInput({ title: "Schema draft", status: "Draft" });
		const drafts = await (await fetch(`${baseUrl}/api/drafts`)).json();
		expect(drafts[0].fields.status).toBe("Draft");
		expect(drafts[0].sections).toBeDefined();
		const settings = await (await fetch(`${baseUrl}/api/config`)).json();
		expect(settings.schema.fields.side.values).toEqual(["Buyer", "Seller"]);
	});

	it("creates a draft through the schema payload without requiring Draft in the status enum", async () => {
		const response = await fetch(`${baseUrl}/api/tasks`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Schema draft",
				fields: { status: "Draft", side: "Buyer" },
				sections: { description: "First draft" },
			}),
		});
		expect(response.status).toBe(201);
		const created = await response.json();
		expect(created.fields).toMatchObject({ status: "Draft", side: "Buyer" });
		expect(created.sections.description).toBe("First draft");
		const drafts = await (await fetch(`${baseUrl}/api/drafts`)).json();
		expect(drafts.some((draft: { id: string }) => draft.id === created.id)).toBe(true);
	});

	it("PATCH validates mixed fields and section operations before writing", async () => {
		const { task } = await core.createTaskFromInput({ title: "Patch target" });
		const patch = (body: unknown) =>
			fetch(`${baseUrl}/api/tasks/${task.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
		const updatedResponse = await patch({
			fields: { priority: "high", side: "seller" },
			sections: { description: "Updated description" },
			checklist: [{ section: "acceptance", op: "add", text: "Verify" }],
			log: { section: "log", body: "Reviewed", author: "@alice" },
		});
		expect(updatedResponse.status).toBe(200);
		const updated = await updatedResponse.json();
		expect(updated.fields).toMatchObject({ priority: "high", side: "Seller" });
		expect(updated.sections.description).toBe("Updated description");
		expect(updated.sections.acceptance[0].text).toBe("Verify");
		expect(updated.sections.log[0].body).toBe("Reviewed");
		const replacedResponse = await patch({
			checklist: [{ section: "acceptance", op: "replace", items: [{ text: "Edited in browser", checked: true }] }],
		});
		expect(replacedResponse.status).toBe(200);
		const replaced = await replacedResponse.json();
		expect(replaced.sections.acceptance).toEqual([{ index: 1, text: "Edited in browser", checked: true }]);
		const invalidChecklist = await patch({
			checklist: [{ section: "acceptance", op: "replace", items: [{ text: "broken", checked: "yes" }] }],
		});
		expect(invalidChecklist.status).toBe(422);
		expect((await core.filesystem.loadTask(task.id))?.acceptanceCriteriaItems?.[0]?.text).toBe("Edited in browser");

		const invalid = await patch({ fields: { side: "unsupported" } });
		expect(invalid.status).toBe(422);
		expect(await invalid.json()).toMatchObject({ errors: [{ key: "fields.side" }] });
		expect((await core.filesystem.loadTask(task.id))?.fieldValues?.side).toBe("Seller");
	});

	it("publishes a live update when task-schema.yml changes", async () => {
		await fetch(`${baseUrl}/api/tasks`);
		const internals = server as unknown as { getContentStoreInstance(): Promise<ContentStore> };
		const store = await internals.getContentStoreInstance();
		let updates = 0;
		const unsubscribe = store.subscribe((event) => {
			if (event.type === "ready") updates += 1;
		});
		try {
			await updateTestTaskSchema(core.filesystem, (schema) => {
				if (schema.fields.side) schema.fields.side.values = ["Buyer", "Seller", "Partner"];
			});
			await retry(
				async () => {
					expect(updates).toBeGreaterThan(1);
				},
				20,
				100,
			);
			const schema = await (await fetch(`${baseUrl}/api/schema`)).json();
			expect(schema.fields.side.values).toEqual(["Buyer", "Seller", "Partner"]);
		} finally {
			unsubscribe();
		}
	});
});
