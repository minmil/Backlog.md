import { describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import SelectControl from "../web/components/SelectControl.tsx";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("shared select control", () => {
	it("uses one padded trigger and rounded option menu for a selected value", async () => {
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		let selected = "";
		await act(async () => {
			root.render(<SelectControl value="a" aria-label="Project" onChange={(event) => { selected = event.target.value; }}>
				<option value="a">Alpha</option>
				<option value="b">Beta</option>
			</SelectControl>);
		});
		const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Project"]');
		expect(trigger?.className).toContain("pr-10");
		await act(async () => { trigger?.click(); });
		const menu = document.querySelector<HTMLElement>('[role="listbox"]');
		expect(menu?.className).toContain("rounded-xl");
		await act(async () => { menu?.querySelector<HTMLElement>('[role="option"][data-value="b"]')?.click(); });
		expect(selected).toBe("b");
		expect(document.querySelector('[role="listbox"]')).toBeNull();
		await act(async () => { root.unmount(); });
		container.remove();
	});
});
