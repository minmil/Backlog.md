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
	globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
	globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(callback, 0);
	globalThis.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle);
	window.matchMedia = () => ({ matches: false }) as MediaQueryList;
	return document.getElementById("root") as HTMLElement;
}

afterEach(() => {
	if (root) act(() => root?.unmount());
	root = null;
	apiClient.fetchSchema = originalFetchSchema;
	apiClient.patchSchemaTask = originalPatch;
});

describe("schema task modal", () => {
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
});
