import { afterEach, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getDefaultTaskSchema } from "../schema/default-schema.ts";
import Statistics from "../web/components/Statistics.tsx";
import { SchemaProvider } from "../web/components/schema/SchemaProvider.tsx";
import { apiClient } from "../web/lib/api.ts";

const originalFetchStatistics = apiClient.fetchStatistics;
const originalFetchSchema = apiClient.fetchSchema;
let root: Root | null = null;

afterEach(async () => {
	await act(async () => { root?.unmount(); });
	root = null;
	apiClient.fetchStatistics = originalFetchStatistics;
	apiClient.fetchSchema = originalFetchSchema;
});

it("refetches statistics using the selected schema field", async () => {
	const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/statistics" });
	globalThis.window = dom.window as unknown as Window & typeof globalThis;
	globalThis.document = dom.window.document;
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	const schema = structuredClone(getDefaultTaskSchema());
	if (schema.fields.project) { schema.fields.project.hidden = false; schema.fields.project.values = ["Alpha", "Beta"]; }
	schema.ui.statistics.filters = ["project", "assignee"];
	schema.users = [{ handle: "@alice", name: "Alice", default: true }];
	apiClient.fetchSchema = async () => schema;
	const requests: string[][] = [];
	apiClient.fetchStatistics = async (where = []) => {
		requests.push(where);
		return {
			statusCounts: { "To Do": 1 }, priorityCounts: {}, noPriorityCount: 0,
			totalTasks: 1, completedTasks: 0, completionPercentage: 0, draftCount: 0,
			recentActivity: { created: [], updated: [] },
			projectHealth: { averageTaskAge: 0, staleTasks: [], blockedTasks: [] },
		};
	};
	const container = document.getElementById("root")!;
	root = createRoot(container);
	await act(async () => { root?.render(<SchemaProvider initialSchema={schema}><Statistics /></SchemaProvider>); });
	const project = container.querySelector<HTMLButtonElement>('button[aria-label="Filter statistics by project"]');
	expect(project?.textContent).toContain("Project");
	expect(container.querySelector('button[aria-label="Filter statistics by type"]')).toBeNull();
	await act(async () => { project?.click(); });
	await act(async () => { document.querySelector<HTMLButtonElement>('[role="option"][data-value="Alpha"]')?.click(); });
	expect(requests.at(-1)).toEqual(["project=Alpha"]);
});
