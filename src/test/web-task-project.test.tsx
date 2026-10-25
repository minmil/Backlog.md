import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { BrowserRouter } from "react-router-dom";
import { getDefaultTaskSchema } from "../schema/default-schema.ts";
import type { Task } from "../types/index.ts";
import BoardPage from "../web/components/BoardPage.tsx";
import TaskCard from "../web/components/TaskCard.tsx";
import { TaskDetailsModal } from "../web/components/TaskDetailsModal.tsx";
import { SchemaProvider } from "../web/components/schema/SchemaProvider.tsx";
import { ThemeProvider } from "../web/contexts/ThemeContext.tsx";
import { apiClient, type SchemaTaskWrite } from "../web/lib/api.ts";
import { setNativeInputValue } from "./react-dom-input.ts";

const createTask = (overrides: Partial<Task> = {}): Task => ({
	id: "TASK-1",
	title: "Projected task",
	status: "To Do",
	assignee: [],
	createdDate: "2026-07-09",
	labels: [],
	dependencies: [],
	...overrides,
});

const originalFetchStatuses = apiClient.fetchStatuses.bind(apiClient);
const originalFetchTasks = apiClient.fetchTasks.bind(apiClient);
const originalPatchSchemaTask = apiClient.patchSchemaTask.bind(apiClient);
let activeRoot: Root | null = null;

function setupDom(url = "http://localhost"): HTMLElement {
	const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url });
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.window = dom.window as unknown as Window & typeof globalThis;
	globalThis.document = dom.window.document as Document;
	globalThis.navigator = dom.window.navigator as Navigator;
	globalThis.localStorage = dom.window.localStorage;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.HTMLInputElement = dom.window.HTMLInputElement;
	globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
	globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(callback, 0);
	globalThis.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle);

	window.matchMedia = () =>
		({
			matches: false,
			media: "",
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		}) as MediaQueryList;

	const htmlElementPrototype = window.HTMLElement.prototype as unknown as {
		attachEvent?: () => void;
		detachEvent?: () => void;
	};
	htmlElementPrototype.attachEvent ??= () => {};
	htmlElementPrototype.detachEvent ??= () => {};

	apiClient.fetchStatuses = async () => ["To Do", "In Progress", "Done"];
	apiClient.fetchTasks = async () => [];

	const container = document.getElementById("root");
	expect(container).toBeTruthy();
	return container as HTMLElement;
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
	await act(async () => {
		setNativeInputValue(input, value);
		await Promise.resolve();
	});
}

async function setSelectValue(select: HTMLSelectElement, value: string): Promise<void> {
	await act(async () => {
		const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
		valueSetter?.call(select, value);
		select.dispatchEvent(new window.Event("change", { bubbles: true }));
		await Promise.resolve();
	});
}

const WAIT_FOR_TIMEOUT_MS = 4000;

async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + WAIT_FOR_TIMEOUT_MS;
	while (!predicate()) {
		if (Date.now() >= deadline) {
			throw new Error(`Timed out after ${WAIT_FOR_TIMEOUT_MS}ms waiting for ${predicate}`);
		}
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
	}
}

afterEach(() => {
	if (activeRoot) {
		act(() => activeRoot?.unmount());
		activeRoot = null;
	}
	apiClient.fetchStatuses = originalFetchStatuses;
	apiClient.fetchTasks = originalFetchTasks;
	apiClient.patchSchemaTask = originalPatchSchemaTask;
});

describe("Web task project UI", () => {
	it("shows a project badge on cards and no badge for unprojected tasks", () => {
		const schema = structuredClone(getDefaultTaskSchema());
		schema.fields.project!.values = ["Web"];
		schema.fields.project!.hidden = false;
		schema.ui.board.card = ["project", ...schema.ui.board.card];
		const webHtml = renderToString(
			<SchemaProvider initialSchema={schema}>
				<TaskCard
				task={createTask({ project: "Web" })}
				onUpdate={() => {}}
				onEdit={() => {}}
				availableProjects={["Web"]}
				/>
			</SchemaProvider>,
		);
		const untaggedHtml = renderToString(
			<SchemaProvider initialSchema={schema}>
				<TaskCard task={createTask()} onUpdate={() => {}} onEdit={() => {}} availableProjects={["Web"]} />
			</SchemaProvider>,
		);

		expect(webHtml).toContain('data-task-project="Web"');
		expect(untaggedHtml).not.toContain("data-task-project");
	});

	it("hides the project badge when no projects are configured, even if the task has one", () => {
		const html = renderToString(
			<TaskCard task={createTask({ project: "Web" })} onUpdate={() => {}} onEdit={() => {}} />,
		);

		expect(html).not.toContain("data-task-project");
	});

	it("omits the project select from the task detail modal when no projects are configured", async () => {
		const container = setupDom();
		const task = createTask({ project: undefined });

		activeRoot = createRoot(container);
		await act(async () => {
			activeRoot?.render(
				<ThemeProvider>
					<TaskDetailsModal task={task} isOpen onClose={() => {}} />
				</ThemeProvider>,
			);
			await Promise.resolve();
		});

		const projectSelect = Array.from(container.querySelectorAll("select")).find(
			(element) => element.options[0]?.textContent === "No Project",
		);
		expect(projectSelect).toBeUndefined();
	});

	it("shows configured project values and saves through the schema PATCH", async () => {
		const container = setupDom();
		const task = createTask({ project: undefined });
		const schema = structuredClone(getDefaultTaskSchema());
		schema.fields.project!.values = ["Web", "API"];
		schema.fields.project!.hidden = false;
		const receivedUpdates: SchemaTaskWrite[] = [];
		apiClient.patchSchemaTask = async (_taskId, updates) => {
			receivedUpdates.push(updates);
			return task;
		};

		activeRoot = createRoot(container);
		await act(async () => {
			activeRoot?.render(
				<ThemeProvider>
					<SchemaProvider initialSchema={schema}><TaskDetailsModal task={task} isOpen onClose={() => {}} /></SchemaProvider>
				</ThemeProvider>,
			);
			await Promise.resolve();
		});

		await act(async () => { container.querySelector<HTMLButtonElement>('button[title="Edit"]')?.click(); });
		const projectSelect = container.querySelector<HTMLSelectElement>("#schema-field-project");
		if (!projectSelect) throw new Error("Schema project selector not rendered");
		expect(Array.from(projectSelect.options).map((option) => option.textContent)).toEqual([
			"No project",
			"Web",
			"API",
		]);
		expect(projectSelect.value).toBe("");

		await setSelectValue(projectSelect, "Web");
		await act(async () => { container.querySelector<HTMLButtonElement>('button[title="Save"]')?.click(); });
		await waitFor(() => receivedUpdates.length === 1);
		expect(receivedUpdates[0]).toEqual({ fields: { project: "Web" } });
	});

	it("does not write a hidden project on an unchanged edit", async () => {
		const container = setupDom();
		const task = createTask({ project: "Retired" });
		const receivedUpdates: SchemaTaskWrite[] = [];
		apiClient.patchSchemaTask = async (_taskId, updates) => {
			receivedUpdates.push(updates);
			return task;
		};

		activeRoot = createRoot(container);
		await act(async () => {
			activeRoot?.render(
				<ThemeProvider>
					<TaskDetailsModal task={task} isOpen onClose={() => {}} />
				</ThemeProvider>,
			);
			await Promise.resolve();
		});

		const clickButton = async (label: string) => {
			const button = Array.from(container.querySelectorAll("button")).find(
				(element) => element.textContent?.trim() === label,
			);
			expect(button).toBeTruthy();
			await act(async () => {
				button?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
				await Promise.resolve();
			});
		};

		await clickButton("Edit");
		await clickButton("Save");
		expect(receivedUpdates).toEqual([]);
	});

	it("creates a task with a configured project", async () => {
		const container = setupDom();
		const schema = structuredClone(getDefaultTaskSchema());
		schema.fields.project!.values = ["Web", "API"];
		schema.fields.project!.hidden = false;
		let submitted: SchemaTaskWrite | undefined;
		activeRoot = createRoot(container);
		await act(async () => {
			activeRoot?.render(
				<ThemeProvider>
					<SchemaProvider initialSchema={schema}>
					<TaskDetailsModal
						isOpen
						onClose={() => {}}
						onSubmit={async (taskData) => {
							submitted = taskData;
						}}
					/>
					</SchemaProvider>
				</ThemeProvider>,
			);
			await Promise.resolve();
		});

		const projectSelect = container.querySelector<HTMLSelectElement>("#schema-field-project");
		const titleInput = container.querySelector("#schema-field-title") as HTMLInputElement | null;
		expect(titleInput).toBeTruthy();
		await setInputValue(titleInput as HTMLInputElement, "API onboarding");
		await setSelectValue(projectSelect as HTMLSelectElement, "API");

		const createButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Create",
		);
		expect(createButton).toBeTruthy();
		await act(async () => {
			createButton?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			await Promise.resolve();
		});
		await waitFor(() => submitted !== undefined);

		expect(submitted?.title).toBe("API onboarding");
		expect(submitted?.fields?.project).toBe("API");
	});
});

describe("Web board project filter", () => {
	const tasks: Task[] = [
		createTask({ id: "task-101", title: "Web task", project: "Web" }),
		createTask({ id: "task-102", title: "API task", project: "API" }),
		createTask({ id: "task-103", title: "Unprojected task" }),
	];

	const renderBoardPage = (url: string | undefined, availableProjects: string[] | undefined): HTMLElement => {
		const container = setupDom(url ?? "http://localhost/board");
		const schema = structuredClone(getDefaultTaskSchema());
		if (availableProjects?.length) {
			schema.fields.project!.values = availableProjects;
			schema.fields.project!.hidden = false;
			schema.ui.board.filters.push("project");
			schema.ui.board.card.push("project");
		}
		activeRoot = createRoot(container);
		act(() => {
			activeRoot?.render(
				<BrowserRouter>
					<SchemaProvider initialSchema={schema}>
					<BoardPage
						tasks={tasks}
						statuses={["To Do", "In Progress", "Done"]}
						milestones={[]}
						availableLabels={[]}
						milestoneEntities={[]}
						archivedMilestones={[]}
						isLoading={false}
						onEditTask={() => {}}
						onNewTask={() => {}}
						availableProjects={availableProjects}
					/>
					</SchemaProvider>
				</BrowserRouter>,
			);
		});
		return container;
	};

	it("omits the project filter select when no projects are configured", () => {
		const container = renderBoardPage(undefined, undefined);
		expect(container.querySelector("select[aria-label='Filter board by project']")).toBeNull();
	});

	it("filters board cards by project and updates the URL", async () => {
		const container = renderBoardPage(undefined, ["Web", "API"]);

		const projectSelect = container.querySelector(
			"select[aria-label='Filter board by project']",
		) as HTMLSelectElement | null;
		expect(projectSelect).toBeTruthy();
		expect(Array.from(projectSelect?.options ?? []).map((option) => option.textContent)).toEqual([
			"All projects",
			"Web",
			"API",
		]);

		await setSelectValue(projectSelect as HTMLSelectElement, "Web");
		expect(new URLSearchParams(window.location.search).get("project")).toBe("Web");
		const text = container.textContent ?? "";
		expect(text).toContain("Web task");
		expect(text).not.toContain("API task");
		expect(text).not.toContain("Unprojected task");
	});

	it("clears unsupported project URL values", async () => {
		const container = renderBoardPage("http://localhost/board?project=mobile", ["Web", "API"]);

		await waitFor(() => new URLSearchParams(window.location.search).get("project") === null);

		const projectSelect = container.querySelector(
			"select[aria-label='Filter board by project']",
		) as HTMLSelectElement | null;
		expect(projectSelect?.value).toBe("");
		const text = container.textContent ?? "";
		expect(text).toContain("Web task");
		expect(text).toContain("API task");
		expect(text).toContain("Unprojected task");
	});
});
