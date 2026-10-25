import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { getDefaultTaskSchema } from "../schema/default-schema.ts";
import type { Task } from "../types/index.ts";
import TaskCard from "../web/components/TaskCard.tsx";
import { SchemaProvider } from "../web/components/schema/SchemaProvider.tsx";

describe("schema board card", () => {
	it("renders configured custom fields in card order", () => {
		const schema = structuredClone(getDefaultTaskSchema());
		schema.fields.side = { type: "enum", label: "Side", values: ["Buyer", "Seller"] };
		schema.fields.estimate = { type: "number", label: "Estimate" };
		schema.ui.board.card = ["side", "type", "estimate", "created_date"];
		const task = {
			id: "TASK-1", title: "Configurable card", status: "To Do", assignee: [], labels: [], dependencies: [],
			createdDate: "2026-10-25", type: "bug", priority: "high", fieldValues: { side: "Buyer", estimate: 5 },
		} satisfies Task;
		const html = renderToString(<SchemaProvider initialSchema={schema}><TaskCard task={task} onUpdate={() => {}} onEdit={() => {}} /></SchemaProvider>);
		expect(html.indexOf('data-field="side"')).toBeLessThan(html.indexOf('data-field="type"'));
		expect(html).toContain("Estimate: ");
		expect(html).toContain(">5<");
		expect(html).not.toContain('data-field="priority"');
	});

	it("shows a sequence reference on cards even when the card layout omits it", () => {
		const schema = structuredClone(getDefaultTaskSchema());
		schema.fields.client_ref = { type: "sequence", scope: "project", prefixes: { Client 1: "C1" }, pad: 3 };
		const task = { id: "TASK-1", title: "Client task", status: "To Do", assignee: [], labels: [], dependencies: [], createdDate: "2026-10-25", fieldValues: { client_ref: "C1-007" } } satisfies Task;
		const html = renderToString(<SchemaProvider initialSchema={schema}><TaskCard task={task} onUpdate={() => {}} onEdit={() => {}} /></SchemaProvider>);
		expect(html).toContain('data-field="client_ref"');
		expect(html).toContain("C1-007");
	});
});
