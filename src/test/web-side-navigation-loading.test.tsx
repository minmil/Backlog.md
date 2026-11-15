import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import BoardPage from "../web/components/BoardPage";
import SideNavigation from "../web/components/SideNavigation";
import { SchemaProvider } from "../web/components/schema/SchemaProvider.tsx";
import { getDefaultTaskSchema } from "../schema/default-schema.ts";

const storage = new Map<string, string>();
globalThis.localStorage = {
	getItem: (key) => storage.get(key) ?? null,
	setItem: (key, value) => storage.set(key, value),
	removeItem: (key) => storage.delete(key),
	clear: () => storage.clear(),
	key: (index) => [...storage.keys()][index] ?? null,
	get length() {
		return storage.size;
	},
} as Storage;

const renderNavigation = (isLoading: boolean, taskCount: number, error?: Error, milestoneLabel?: string): string => {
	const defaultSchema = getDefaultTaskSchema();
	const schema = milestoneLabel
		? { ...defaultSchema, fields: { ...defaultSchema.fields, milestone: { ...defaultSchema.fields.milestone!, label: milestoneLabel } } }
		: defaultSchema;
	return renderToString(
		<MemoryRouter>
			<SchemaProvider initialSchema={schema}>
			<SideNavigation
				taskCount={taskCount}
				docs={[]}
				decisions={[]}
				isLoading={isLoading}
				error={error}
				onRetry={async () => {}}
				onRefreshData={async () => {}}
			/>
			</SchemaProvider>
		</MemoryRouter>,
	);
};

const renderBoard = (isLoading: boolean, error?: Error): string =>
	renderToString(
		<MemoryRouter>
			<BoardPage
				onEditTask={() => {}}
				onNewTask={() => {}}
				tasks={[]}
				statuses={["To Do", "Done"]}
				milestones={[]}
				availableLabels={[]}
				milestoneEntities={[]}
				archivedMilestones={[]}
				isLoading={isLoading}
				loadError={error}
				onRefreshData={async () => {}}
			/>
		</MemoryRouter>,
	);

describe("SideNavigation task loading", () => {
	it("uses the configured milestone label in both sidebar layouts", () => {
		const expanded = renderNavigation(false, 3, undefined, "Release");
		expect(expanded).toContain(">Releases</span>");
		storage.set("sideNavCollapsed", "true");
		try {
			const collapsed = renderNavigation(false, 3, undefined, "Release");
			expect(collapsed).toContain('data-tooltip-content="Releases"');
		} finally {
			storage.delete("sideNavCollapsed");
		}
	});
	it("keeps navigation mounted while only the task count is loading", () => {
		const loading = renderNavigation(true, 0);
		expect(loading).toContain("Kanban Board");
		expect(loading).toContain("All Tasks");
		expect(loading).toContain('aria-label="Loading task count"');
		expect(loading).toContain('aria-label="Loading document count"');
		expect(loading).toContain('aria-label="Loading decision count"');
		expect(loading).toContain('aria-label="Loading content"');
		expect(loading).not.toContain("No documents");
		expect(loading).not.toContain("No decisions");

		const loaded = renderNavigation(false, 3).replaceAll("<!-- -->", "");
		expect(loaded).toContain("Kanban Board");
		expect(loaded).toContain("All Tasks");
		expect(loaded).toContain("Tasks (3)");
		expect(loaded).toContain("Documents (0)");
		expect(loaded).toContain("Decisions (0)");
		expect(loaded).toContain("No documents");
		expect(loaded).toContain("No decisions");
		expect(loaded).not.toContain('aria-label="Loading task count"');
	});

	it("shows a distinct unavailable presentation and exposes retry after a corpus failure", () => {
		const failed = renderNavigation(false, 0, new Error("corpus failed"));
		expect(failed).toContain("Failed to load navigation");
		expect(failed).toContain("Retry");
		expect(failed).toContain('aria-label="task count unavailable"');
		expect(failed).not.toContain('aria-label="Loading task count"');
		expect(failed).not.toContain("No documents");
		expect(failed).not.toContain("No decisions");
	});

	it("keeps a retryable load failure visible when the sidebar is collapsed", () => {
		storage.set("sideNavCollapsed", "true");
		try {
			const failed = renderNavigation(false, 0, new Error("corpus failed"));
			expect(failed).toContain('role="alert"');
			expect(failed).toContain('aria-label="Failed to load navigation. Retry"');
			expect(failed).toContain("Retry");
		} finally {
			storage.delete("sideNavCollapsed");
		}
	});

	it("keeps Kanban loading, loaded-empty, and error states distinct", () => {
		const loading = renderBoard(true);
		expect(loading).toContain("Kanban Board");
		expect(loading).toContain('role="status"');
		expect(loading).not.toContain("Empty");

		const loadedEmpty = renderBoard(false);
		expect(loadedEmpty).toContain("Empty");
		expect(loadedEmpty).not.toContain('aria-label="Loading tasks"');

		const failed = renderBoard(false, new Error("corpus failed"));
		expect(failed).toContain("Failed to load tasks");
		expect(failed).toContain("corpus failed");
		expect(failed).toContain("Retry");
		expect(failed).not.toContain("Empty");
	});
});
