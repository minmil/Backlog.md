import { expect, test } from "bun:test";
import type { HtmlSnapshot } from "../export/html-snapshot.ts";
import { getDefaultTaskSchema } from "../schema/default-schema.ts";
import { getDefaultTaskSchemaText, parseTaskSchema } from "../schema/index.ts";
import { SnapshotBackend } from "../web/snapshot-backend.ts";

test("offline moves set the default outcome and date, and edits can choose another outcome", async () => {
	const schema = parseTaskSchema(
		getDefaultTaskSchemaText().replace(
			"  status: {type: enum, core: true, required: true, values: [To Do, In Progress, Done], default: To Do}",
			"  status: {type: enum, core: true, required: true, values: [To Do, In Progress, Closed], default: To Do, outcomes: [Done, Deferred, No longer needed], outcome_date: true}",
		),
	);
	const backend = new SnapshotBackend({
		formatVersion: 2,
		generatedAt: "2026-11-15T00:00:00Z",
		projectName: "Offline",
		taskCount: 1,
		archivedTaskCount: 0,
		schema,
		tasks: [
			{
				id: "TASK-1",
				title: "One",
				status: "To Do",
				assignee: [],
				labels: [],
				dependencies: [],
				createdDate: "2026-11-01",
				fieldValues: {},
			},
		],
		archivedTasks: [],
	});
	const request = (path: string, method = "GET", body?: unknown) =>
		backend.fetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
	await request("/api/tasks/move", "POST", { taskIds: ["TASK-1"], targetStatus: "Closed" });
	let task = (await (await request("/api/task/TASK-1")).json()) as { fieldValues: Record<string, unknown> };
	expect(task.fieldValues.outcome).toBe("Done");
	expect(task.fieldValues.outcome_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	await request("/api/tasks/TASK-1", "PATCH", { fields: { outcome: "Deferred" } });
	task = (await (await request("/api/task/TASK-1")).json()) as { fieldValues: Record<string, unknown> };
	expect(task.fieldValues.outcome).toBe("Deferred");
	const stats = await (await request("/api/statistics")).json();
	expect(stats).toMatchObject({ completedTasks: 0, outcomeCounts: { Done: 0, Deferred: 1 } });
});

test("offline statistics count the configured Closed status as completed", async () => {
	const backend = new SnapshotBackend({
		formatVersion: 2,
		generatedAt: "2026-01-01T00:00:00Z",
		projectName: "Offline",
		taskCount: 2,
		archivedTaskCount: 0,
		schema: getDefaultTaskSchema(),
		config: { projectName: "Offline", statuses: ["To Do", "Closed"], labels: [], dateFormat: "YYYY-MM-DD" },
		tasks: [
			{
				id: "TASK-1",
				title: "Finished",
				status: "Closed",
				assignee: [],
				labels: [],
				dependencies: [],
				createdDate: "2026-01-01",
			},
			{
				id: "TASK-2",
				title: "Open",
				status: "To Do",
				assignee: [],
				labels: [],
				dependencies: ["TASK-1"],
				createdDate: "2026-01-01",
			},
		],
		archivedTasks: [],
	});
	const statistics = await (await backend.fetch("/api/statistics")).json();
	expect(statistics).toMatchObject({ totalTasks: 2, completedTasks: 1, completionPercentage: 50 });
	expect(statistics.statusCounts.Closed).toBe(1);
	expect(statistics.projectHealth.blockedTasks).toEqual([]);
});

test("offline backend applies task edits, creates, moves, and archives in embedded data", async () => {
	const schema = getDefaultTaskSchema();
	const snapshot: HtmlSnapshot = {
		formatVersion: 2,
		generatedAt: "2026-01-01T00:00:00Z",
		projectName: "Offline",
		taskCount: 1,
		archivedTaskCount: 0,
		schema,
		config: {
			projectName: "Offline",
			statuses: ["To Do", "In Progress", "Done"],
			labels: [],
			dateFormat: "YYYY-MM-DD",
		},
		tasks: [
			{
				id: "TASK-1",
				title: "Original",
				status: "To Do",
				assignee: [],
				labels: [],
				dependencies: [],
				createdDate: "2026-01-01",
			},
		],
		archivedTasks: [],
	};
	const backend = new SnapshotBackend(snapshot);
	const request = (path: string, method = "GET", body?: unknown) =>
		backend.fetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
	const initial = await (await request("/api/search")).json();
	expect(initial).toHaveLength(1);
	expect(initial[0].task.title).toBe("Original");
	const edit = await request("/api/tasks/TASK-1", "PATCH", { fields: { title: "Reviewed", status: "In Progress" } });
	expect(edit.status).toBe(200);
	expect((await edit.json()).title).toBe("Reviewed");
	const detail = await (await request("/api/task/TASK-1")).json();
	expect(detail.status).toBe("In Progress");
	expect(detail.dependencyGraph).toBeDefined();
	const created = await (await request("/api/tasks", "POST", { title: "Second", fields: { status: "To Do" } })).json();
	expect(created.id).toBe("TASK-2");
	const moved = await (await request("/api/tasks/move", "POST", { taskIds: ["TASK-2"], targetStatus: "Done" })).json();
	expect(moved.changedTasks[0].status).toBe("Done");
	expect(await (await request("/api/search?status=Done")).json()).toHaveLength(1);
	await request("/api/tasks/TASK-1/archive", "POST");
	expect((await (await request("/api/search")).json()).map((item: { task: { id: string } }) => item.task.id)).toEqual([
		"TASK-2",
	]);
	expect(snapshot.tasks[0]?.title).toBe("Original");
});

test("offline backend reads and edits other active browser records", async () => {
	const backend = new SnapshotBackend({
		formatVersion: 2,
		generatedAt: "2026-01-01T00:00:00Z",
		projectName: "Offline",
		taskCount: 0,
		archivedTaskCount: 0,
		schema: getDefaultTaskSchema(),
		tasks: [],
		archivedTasks: [],
		drafts: [
			{
				id: "DRAFT-1",
				title: "Draft",
				status: "Draft",
				assignee: [],
				labels: [],
				dependencies: [],
				createdDate: "2026-01-01",
			},
		],
		docs: [
			{
				id: "doc-1",
				title: "Guide",
				type: "guide",
				createdDate: "2026-01-01",
				rawContent: "Old guide",
				path: "guides/doc-1 - Guide.md",
			},
		],
		decisions: [
			{
				id: "decision-1",
				title: "Choice",
				date: "2026-01-01",
				status: "proposed",
				context: "",
				decision: "",
				consequences: "",
				rawContent: "Old choice",
			},
		],
		milestones: [{ id: "m-1", title: "Phase", description: "", rawContent: "" }],
	});
	const request = (path: string, method = "GET", body?: unknown) =>
		backend.fetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
	expect((await (await request("/api/search")).json()).map((result: { type: string }) => result.type)).toEqual([
		"document",
		"decision",
	]);
	expect((await (await request("/api/drafts")).json())[0].title).toBe("Draft");
	expect((await (await request("/api/doc/doc-1")).json()).rawContent).toBe("Old guide");
	await request("/api/docs/guides%2Fdoc-1%20-%20Guide.md", "PUT", { content: "New guide" });
	expect((await (await request("/api/docs")).json())[0].rawContent).toBe("New guide");
	await backend.fetch("/api/decisions/decision-1", { method: "PUT", body: "New choice" });
	expect((await (await request("/api/decision/decision-1")).json()).rawContent).toBe("New choice");
	await request("/api/milestones/m-1", "PUT", { title: "Updated phase" });
	expect((await (await request("/api/milestones")).json())[0].title).toBe("Updated phase");
});
