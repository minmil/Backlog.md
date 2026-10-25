import { describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { getDefaultTaskSchema } from "../schema/default-schema.ts";
import type { FieldType, TaskSchema } from "../schema/types.ts";
import { ThemeProvider } from "../web/contexts/ThemeContext.tsx";
import { apiClient } from "../web/lib/api.ts";
import FieldInput from "../web/components/schema/FieldInput.tsx";
import FieldValue from "../web/components/schema/FieldValue.tsx";
import OtherContent from "../web/components/schema/OtherContent.tsx";
import { SchemaProvider, useSchema } from "../web/components/schema/SchemaProvider.tsx";
import SectionBlock from "../web/components/schema/SectionBlock.tsx";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
window.matchMedia = () => ({ matches: false }) as MediaQueryList;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function schemaWithField(type: FieldType): TaskSchema {
	const schema = structuredClone(getDefaultTaskSchema());
	schema.users = [{ handle: "@alice", name: "Alice", default: true }];
	schema.fields.sample = { type, label: "Sample", values: ["Alpha", "Beta"] };
	return schema;
}

const examples: Array<{ type: FieldType; value: string | number | boolean | string[]; expected: string; control: string }> = [
	{ type: "id", value: "TASK-1", expected: "TASK-1", control: 'type="text"' },
	{ type: "text", value: "Some text", expected: "Some text", control: 'type="text"' },
	{ type: "bool", value: true, expected: "Yes", control: 'type="checkbox"' },
	{ type: "date", value: "2026-10-25", expected: "2026", control: 'type="date"' },
	{ type: "datetime", value: "2026-10-25T09:00:00Z", expected: "2026", control: 'type="text"' },
	{ type: "enum", value: "Alpha", expected: "Alpha", control: "<select" },
	{ type: "multi-enum", value: ["Alpha", "Beta"], expected: "Alpha", control: "chip-input-sample" },
	{ type: "string-list", value: ["first", "second"], expected: "first", control: "chip-input-sample" },
	{ type: "user", value: "@alice", expected: "Alice", control: "<select" },
	{ type: "user-list", value: ["@alice"], expected: "Alice", control: "chip-input-sample" },
	{ type: "task-ref", value: "TASK-2", expected: "TASK-2", control: 'type="text"' },
	{ type: "task-ref-list", value: ["TASK-2"], expected: "TASK-2", control: "chip-input-sample" },
	{ type: "milestone-ref", value: "M-1", expected: "M-1", control: 'type="text"' },
	{ type: "number", value: 7, expected: "7", control: 'type="number"' },
];

describe("schema field components", () => {
	it("re-fetches the schema when the server announces a live update", async () => {
		const originalFetch = apiClient.fetchSchema;
		const first = schemaWithField("enum");
		first.fields.sample = { type: "enum", label: "First", values: ["Alpha", "Beta"] };
		const second = schemaWithField("enum");
		second.fields.sample = { type: "enum", label: "Second", values: ["Alpha", "Beta"] };
		let next = first;
		apiClient.fetchSchema = async () => next;
		const container = document.createElement("div");
		const root = createRoot(container);
		const Label = () => <span>{useSchema().field("sample")?.label}</span>;
		try {
			await act(async () => { root.render(<SchemaProvider><Label /></SchemaProvider>); });
			expect(container.textContent).toBe("First");
			next = second;
			await act(async () => { window.dispatchEvent(new window.Event("backlog-data-updated")); });
			expect(container.textContent).toBe("Second");
		} finally {
			await act(async () => { root.unmount(); });
			apiClient.fetchSchema = originalFetch;
		}
	});

	for (const example of examples) {
		it(`renders ${example.type} through FieldValue`, () => {
			const html = renderToStaticMarkup(<SchemaProvider initialSchema={schemaWithField(example.type)}><FieldValue fieldKey="sample" value={example.value} variant="detail" /></SchemaProvider>);
			expect(html).toContain(example.expected);
		});

		it(`provides a ${example.type} FieldInput`, () => {
			const html = renderToStaticMarkup(<SchemaProvider initialSchema={schemaWithField(example.type)}><FieldInput fieldKey="sample" value={example.value} onChange={() => {}} /></SchemaProvider>);
			expect(html).toContain("Sample");
			expect(html).toContain(example.control);
		});
	}

	it("renders overdue dates using the existing validation error text color", () => {
		const html = renderToStaticMarkup(<SchemaProvider initialSchema={schemaWithField("date")}><FieldValue fieldKey="sample" value="2026-10-24" variant="cell" overdue /></SchemaProvider>);
		expect(html).toContain("text-red-600 dark:text-red-400");
		expect(html).toContain("overdue");
	});

	it("renders a markdown section", () => {
		const html = renderToStaticMarkup(<ThemeProvider><SchemaProvider><SectionBlock sectionId="description" value="A description" mode="view" /></SchemaProvider></ThemeProvider>);
		expect(html).toContain("A description");
		const editing = renderToStaticMarkup(<ThemeProvider><SchemaProvider><SectionBlock sectionId="description" value="A description" mode="edit" onChange={() => {}} /></SchemaProvider></ThemeProvider>);
		expect(editing).toContain("A description");
	});

	it("renders a checklist section", () => {
		const html = renderToStaticMarkup(<ThemeProvider><SchemaProvider><SectionBlock sectionId="acceptance" value={[{ index: 1, text: "Verified", checked: true }]} mode="view" /></SchemaProvider></ThemeProvider>);
		expect(html).toContain("Verified");
		expect(html).toContain("checked");
		const editing = renderToStaticMarkup(<ThemeProvider><SchemaProvider><SectionBlock sectionId="acceptance" value={[]} mode="edit" onChange={() => {}} /></SchemaProvider></ThemeProvider>);
		expect(editing).toContain("New criterion");
	});

	it("renders a log section", () => {
		const html = renderToStaticMarkup(<ThemeProvider><SchemaProvider><SectionBlock sectionId="log" value={[{ author: "@alice", date: "2026-10-25", createdAt: "2026-10-25T09:00:00Z", body: "Reviewed" }]} mode="view" /></SchemaProvider></ThemeProvider>);
		expect(html).toContain("Reviewed");
		expect(html).toContain("@alice");
		const schema = structuredClone(getDefaultTaskSchema());
		schema.users = [{ handle: "@alice", name: "Alice", default: true }];
		const editing = renderToStaticMarkup(<ThemeProvider><SchemaProvider initialSchema={schema}><SectionBlock sectionId="log" value={[]} mode="edit" onAppendLog={() => {}} /></SchemaProvider></ThemeProvider>);
		expect(editing).toContain("Log author");
		expect(editing).toContain("Alice");
	});

	it("hides empty Other content and shows preserved prose", () => {
		expect(renderToStaticMarkup(<OtherContent other="" />)).toBe("");
		expect(renderToStaticMarkup(<OtherContent other="Preserved note" />)).toContain("Preserved note");
	});
});
