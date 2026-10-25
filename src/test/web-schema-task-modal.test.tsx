import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getDefaultTaskSchema } from "../schema/default-schema.ts";
import type { Task } from "../types/index.ts";
import { TaskDetailsModal } from "../web/components/TaskDetailsModal.tsx";
import { SchemaProvider } from "../web/components/schema/SchemaProvider.tsx";
import { ThemeProvider } from "../web/contexts/ThemeContext.tsx";
import { apiClient, type SchemaTaskWrite } from "../web/lib/api.ts";
import { setNativeInputValue } from "./react-dom-input.ts";

const originalFetchSchema = apiClient.fetchSchema;
const originalPatch = apiClient.patchSchemaTask;
let root: Root | null = null;

function setupDom(): HTMLElement {
	const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost" });
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.window = dom.window as unknown as Window & typeof globalThis;
	globalThis.document = dom.window.document;
	globalThis.navigator = dom.window.navigator;
	globalThis.localStorage = dom.window.localStorage;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.HTMLInputElement = dom.window.HTMLInputElement;
	globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
	globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
	globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(callback, 0);
	globalThis.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle);
	window.matchMedia = () => ({ matches: false }) as MediaQueryList;
	const prototype = window.HTMLElement.prototype as unknown as { attachEvent?: () => void; detachEvent?: () => void };
	prototype.attachEvent ??= () => {};
	prototype.detachEvent ??= () => {};
	return document.getElementById("root") as HTMLElement;
}

afterEach(() => {
	if (root) act(() => root?.unmount());
	root = null;
	apiClient.fetchSchema = originalFetchSchema;
	apiClient.patchSchemaTask = originalPatch;
});

describe("schema task modal", () => {
	it("creates a task with schema fields and sections", async () => {
		const container = setupDom();
		const schema = structuredClone(getDefaultTaskSchema());
		schema.fields.side = { type: "enum", label: "Side", values: ["Buyer", "Seller"] };
		schema.users = [{ handle: "@alice", name: "Alice", default: true }];
		apiClient.fetchSchema = async () => schema;
		const submissions: SchemaTaskWrite[] = [];
		root = createRoot(container);
		await act(async () => { root?.render(<ThemeProvider><SchemaProvider initialSchema={schema}><TaskDetailsModal isOpen onClose={() => {}} onSubmit={async (input) => { submissions.push(input); }} /></SchemaProvider></ThemeProvider>); });
		const title = container.querySelector<HTMLInputElement>("#schema-field-title");
		const description = container.querySelector<HTMLTextAreaElement>('textarea.w-md-editor-text-input');
		expect(description).toBeTruthy();
		await act(async () => {
			if (title) setNativeInputValue(title, "New schema task");
			if (description) setNativeInputValue(description, "A schema section");
		});
		const side = container.querySelector<HTMLSelectElement>("#schema-field-side");
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
			setter?.call(side, "Buyer");
			side?.dispatchEvent(new window.Event("change", { bubbles: true }));
		});
		const criterion = container.querySelector<HTMLTextAreaElement>('textarea[placeholder="New criterion"]');
		await act(async () => { if (criterion) setNativeInputValue(criterion, "Ready for review"); });
		const acceptance = Array.from(container.querySelectorAll("section")).find((item) => item.querySelector("h2")?.textContent === "Acceptance Criteria");
		await act(async () => { Array.from(acceptance?.querySelectorAll("button") ?? []).find((button) => button.textContent === "Add")?.click(); });
		const logBody = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Log entry"]');
		await act(async () => { if (logBody) setNativeInputValue(logBody, "Created by Alice"); });
		const log = Array.from(container.querySelectorAll("section")).find((item) => item.querySelector("h2")?.textContent === "Log");
		await act(async () => { Array.from(log?.querySelectorAll("button") ?? []).find((button) => button.textContent === "Add")?.click(); });
		await act(async () => { container.querySelector<HTMLButtonElement>('button[title="Save"]')?.click(); });
		expect(submissions).toEqual([{ title: "New schema task", fields: { status: "To Do", assignee: ["@alice"], reporter: "@alice", side: "Buyer" }, sections: { description: "A schema section" }, checklist: [{ section: "acceptance", op: "add", text: "Ready for review" }], log: { section: "log", body: "Created by Alice", author: "@alice", date: container.querySelector<HTMLInputElement>('input[aria-label="Log date"]')?.value } }]);
	});
	it("shows a custom field in the sidebar and saves it through one PATCH", async () => {
		const container = setupDom();
		const schema = structuredClone(getDefaultTaskSchema());
		schema.fields.side = { type: "enum", label: "Side", values: ["Buyer", "Seller"] };
		apiClient.fetchSchema = async () => schema;
		const task = {
			id: "TASK-1", title: "Schema task", status: "To Do", assignee: [], labels: [], dependencies: [], createdDate: "2026-10-25",
			fields: { side: "Buyer", status: "To Do" },
		} as Task;
		const patches: SchemaTaskWrite[] = [];
		apiClient.patchSchemaTask = async (_id, patch) => { patches.push(patch); return task; };
		root = createRoot(container);
		await act(async () => {
			root?.render(<ThemeProvider><SchemaProvider initialSchema={schema}><TaskDetailsModal task={task} isOpen onClose={() => {}} /></SchemaProvider></ThemeProvider>);
		});
		expect(container.textContent).toContain("Side");
		await act(async () => {
			container.querySelector<HTMLButtonElement>('button[title="Edit"]')?.click();
		});
		const select = container.querySelector<HTMLSelectElement>("#schema-field-side");
		expect(select).toBeTruthy();
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
			setter?.call(select, "Seller");
			select?.dispatchEvent(new window.Event("change", { bubbles: true }));
		});
		await act(async () => {
			container.querySelector<HTMLButtonElement>('button[title="Save"]')?.click();
		});
		expect(patches).toEqual([{ fields: { side: "Seller" } }]);
	});

	it("renders configured sections and saves checklist edits through one PATCH", async () => {
		const container = setupDom();
		const schema = structuredClone(getDefaultTaskSchema());
		schema.sections.delivery_notes = { kind: "markdown", title: "Delivery Notes" };
		apiClient.fetchSchema = async () => schema;
		const task = {
			id: "TASK-2", title: "Section task", status: "To Do", assignee: [], labels: [], dependencies: [], createdDate: "2026-10-25",
			fields: { status: "To Do" },
			sections: { description: "Description from schema", acceptance: [], log: [], delivery_notes: "UAT details" },
			other: "Preserved loose note",
		} as Task;
		const patches: SchemaTaskWrite[] = [];
		apiClient.patchSchemaTask = async (_id, patch) => { patches.push(patch); return task; };
		root = createRoot(container);
		await act(async () => {
			root?.render(<ThemeProvider><SchemaProvider initialSchema={schema}><TaskDetailsModal task={task} isOpen onClose={() => {}} /></SchemaProvider></ThemeProvider>);
		});
		expect(container.textContent).toContain("UAT details");
		expect(container.textContent).toContain("Preserved loose note");
		await act(async () => { container.querySelector<HTMLButtonElement>('button[title="Edit"]')?.click(); });
		const input = container.querySelector<HTMLTextAreaElement>('textarea[placeholder="New criterion"]');
		expect(input).toBeTruthy();
		await act(async () => { if (input) setNativeInputValue(input, "Ready for review"); });
		const section = Array.from(container.querySelectorAll("section")).find((item) => item.querySelector("h2")?.textContent === "Acceptance Criteria");
		await act(async () => { Array.from(section?.querySelectorAll("button") ?? []).find((button) => button.textContent === "Add")?.click(); });
		await act(async () => { container.querySelector<HTMLButtonElement>('button[title="Save"]')?.click(); });
		expect(patches).toEqual([{ checklist: [{ section: "acceptance", op: "replace", items: [{ index: 1, text: "Ready for review", checked: false }] }] }]);
	});

	it("appends a log entry with the selected author and date", async () => {
		const container = setupDom();
		const schema = structuredClone(getDefaultTaskSchema());
		schema.users = [{ handle: "@alice", name: "Alice", default: true }];
		apiClient.fetchSchema = async () => schema;
		const task = {
			id: "TASK-3", title: "Log task", status: "To Do", assignee: [], labels: [], dependencies: [], createdDate: "2026-10-25",
			fields: { status: "To Do" }, sections: { description: "", acceptance: [], log: [] },
		} as Task;
		const patches: SchemaTaskWrite[] = [];
		apiClient.patchSchemaTask = async (_id, patch) => { patches.push(patch); return task; };
		root = createRoot(container);
		await act(async () => {
			root?.render(<ThemeProvider><SchemaProvider initialSchema={schema}><TaskDetailsModal task={task} isOpen onClose={() => {}} /></SchemaProvider></ThemeProvider>);
		});
		await act(async () => { container.querySelector<HTMLButtonElement>('button[title="Edit"]')?.click(); });
		const author = container.querySelector<HTMLSelectElement>('select[aria-label="Log author"]');
		expect(author?.value).toBe("@alice");
		const date = container.querySelector<HTMLInputElement>('input[aria-label="Log date"]');
		expect(date).toBeTruthy();
		const body = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Log entry"]');
		expect(body).toBeTruthy();
		await act(async () => { if (body) setNativeInputValue(body, "Reviewed by Alice"); });
		const logSection = Array.from(container.querySelectorAll("section")).find((item) => item.querySelector("h2")?.textContent === "Log");
		await act(async () => { Array.from(logSection?.querySelectorAll("button") ?? []).find((button) => button.textContent === "Add")?.click(); });
		expect(patches).toEqual([{ log: { section: "log", body: "Reviewed by Alice", author: "@alice", date: date?.value } }]);
	});
});
