import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { getDefaultTaskSchema } from "../schema/default-schema.ts";
import FieldFilter from "../web/components/schema/FieldFilter.tsx";
import { SchemaProvider } from "../web/components/schema/SchemaProvider.tsx";

describe("schema field filters", () => {
	it("uses the configured field label for the empty project option", () => {
		const schema = structuredClone(getDefaultTaskSchema());
		schema.fields.project = { type: "enum", core: true, label: "Client", values: ["Client 1", "Client 2"] };
		const html = renderToString(<SchemaProvider initialSchema={schema}><FieldFilter fieldKey="project" value={null} onChange={() => {}} /></SchemaProvider>);
		expect(html).toContain("All clients");
		expect(html).not.toContain("All projects");
	});
});
