import { expect, test } from "bun:test";
import type { HtmlSnapshot } from "../export/html-snapshot.ts";
import { getDefaultTaskSchema } from "../schema/default-schema.ts";
import { SnapshotBackend } from "../web/snapshot-backend.ts";

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
