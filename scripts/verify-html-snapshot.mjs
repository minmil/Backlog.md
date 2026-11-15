import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";

const path = process.argv[2];
if (!path) throw new Error("Usage: node scripts/verify-html-snapshot.mjs <snapshot.html>");
const count = Number(process.argv[3] ?? 100);
const html = await readFile(path, "utf8");
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => errors.push(error.message));
virtualConsole.on("error", (message) => errors.push(String(message)));
let requests = 0;
let savedHtml = "";
const dom = new JSDOM(html, {
	url: `file://${path}`,
	runScripts: "outside-only",
	virtualConsole,
	beforeParse(window) {
		window.Blob = class {
			constructor(parts) { this.parts = parts; }
		};
		window.URL.createObjectURL = (blob) => { savedHtml = blob.parts.join(""); return "blob:review-copy"; };
		window.URL.revokeObjectURL = () => {};
		window.HTMLAnchorElement.prototype.click = function () { if (!this.download) throw new Error("Unexpected anchor click"); };
		window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
		window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
		window.cancelAnimationFrame = clearTimeout;
		window.fetch = () => {
			requests++;
			throw new Error("Snapshot attempted fetch");
		};
		window.XMLHttpRequest.prototype.open = () => {
			requests++;
			throw new Error("Snapshot attempted XHR");
		};
		window.WebSocket = class {
			constructor() {
				requests++;
				throw new Error("Snapshot attempted WebSocket");
			}
		};
		window.EventSource = class {
			constructor() {
				requests++;
				throw new Error("Snapshot attempted EventSource");
			}
		};
	},
});
const { document, MouseEvent, Event, HTMLInputElement } = dom.window;
const waitFor = async (check) => {
	for (let attempt = 0; attempt < 40; attempt++) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`Timed out waiting for viewer: ${document.getElementById("root")?.textContent?.slice(0, 300)}`);
};
const click = (element) => {
	assert.ok(element, "Expected clickable element");
	element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
};
const button = (label) =>
	[...document.querySelectorAll("button")].find((element) => element.textContent.trim() === label);
const setInput = (element, value) => {
	const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
	setter.call(element, value);
	element.dispatchEvent(new Event("input", { bubbles: true }));
};
try {
	assert.equal(document.querySelectorAll("script").length, 2, "Only embedded data and code scripts are allowed");
	assert.equal(document.querySelectorAll("script[src],link[href],iframe,object,embed").length, 0);
	assert.match(
		document.querySelector("meta[http-equiv='Content-Security-Policy']")?.content ?? "",
		/connect-src 'none'/,
	);
	assert.doesNotMatch(document.querySelector("style")?.textContent ?? "", /@import|url\(\s*['"]?https?:/i);
	assert.equal(document.querySelector("script[type='application/json']")?.textContent?.includes("</script>"), false);
	const script = document.querySelector("script:not([type])")?.textContent;
	assert.ok(script);
	const startupStart = performance.now();
	dom.window.eval(script);
	await waitFor(
		() => document.querySelectorAll("[data-snapshot-board] [role='button']").length === Math.min(count, 100),
	);
	const startupMs = performance.now() - startupStart;
	assert.match(document.getElementById("root").textContent, /日本語/);
	assert.equal(document.querySelectorAll("[draggable='true']").length, 0);
	const listStart = performance.now();
	click(button("List"));
	await waitFor(() => document.querySelectorAll("[data-snapshot-list] tbody tr").length === Math.min(count, 100));
	const listMs = performance.now() - listStart;
	const archive = document.querySelector("input[type='checkbox']");
	assert.ok(archive);
	archive.click();
	await waitFor(() => document.querySelector("[role='status']")?.textContent.includes(`${count + 1} matching tasks`));
	archive.click();
	await waitFor(() => document.querySelector("[role='status']")?.textContent.includes(`${count} matching tasks`));
	const query = document.querySelector("input[aria-label='Search tasks']");
	const searchStart = performance.now();
	setInput(query, "Task 42 日本語");
	await waitFor(() => document.querySelectorAll("[data-snapshot-list] tbody tr").length === 1);
	const searchMs = performance.now() - searchStart;
	assert.match(document.querySelector("[data-snapshot-list]").textContent, /TASK-42/);
	setInput(query, "");
	await waitFor(() => document.querySelectorAll("[data-snapshot-list] tbody tr").length === Math.min(count, 100));
	const filter = document.querySelector("select[aria-label='Filter value']");
	filter.value = "In Progress";
	filter.dispatchEvent(new Event("change", { bubbles: true }));
	await waitFor(() =>
		document.querySelector("[role='status']")?.textContent.includes(`${Math.floor(count / 3)} matching tasks`),
	);
	assert.equal(document.querySelectorAll("[data-snapshot-list] tbody tr").length, Math.min(Math.floor(count / 3), 100));
	filter.value = "";
	filter.dispatchEvent(new Event("change", { bubbles: true }));
	await waitFor(() => document.querySelectorAll("[data-snapshot-list] tbody tr").length === Math.min(count, 100));
	const filterField = document.querySelector("select[aria-label='Filter field']");
	filterField.value = "custom_score";
	filterField.dispatchEvent(new Event("change", { bubbles: true }));
	await waitFor(() => [...filter.options].some((option) => option.value === "42"));
	filter.value = "42";
	filter.dispatchEvent(new Event("change", { bubbles: true }));
	await waitFor(() => document.querySelector("[role='status']")?.textContent.includes("1 matching tasks"));
	filterField.value = "status";
	filterField.dispatchEvent(new Event("change", { bubbles: true }));
	await waitFor(() => document.querySelectorAll("[data-snapshot-list] tbody tr").length === Math.min(count, 100));
	const sort = document.querySelector("select[aria-label='Sort by']");
	sort.value = "custom_score";
	sort.dispatchEvent(new Event("change", { bubbles: true }));
	click(button("Ascending"));
	await waitFor(() => document.querySelector("[data-snapshot-list] tbody tr")?.textContent.includes(`TASK-${count - 1}`));
	sort.value = "id";
	sort.dispatchEvent(new Event("change", { bubbles: true }));
	click(button("Descending"));
	await waitFor(() => document.querySelector("[data-snapshot-list] tbody tr")?.textContent.includes("TASK-1"));
	const detailStart = performance.now();
	click(
		[...document.querySelectorAll("[data-snapshot-list] tbody tr button")].find(
			(item) => item.textContent === "TASK-3",
		),
	);
	await waitFor(() => document.querySelector("[role='dialog']")?.textContent.includes("Created the task. 日本語"));
	const detailMs = performance.now() - detailStart;
	const dialog = document.querySelector("[role='dialog']");
	assert.match(dialog.textContent, /Score/);
	assert.match(dialog.textContent, /Review the result/);
	assert.equal(dialog.querySelectorAll("input[type='checkbox']:not([disabled])").length, 0);
	assert.equal(
		[...dialog.querySelectorAll("button")].some((item) =>
			/^(Edit|Save|Create|Archive Task)$/.test(item.textContent.trim()),
		),
		false,
	);
	assert.ok(dialog.querySelectorAll("a[href='/tasks/TASK-2']").length >= 2, "Markdown and field task links render");
	click(dialog.querySelector("a[href='/tasks/TASK-2']"));
	await waitFor(() => document.querySelector("#modal-title")?.textContent.includes("TASK-2 — Task 2 日本語"));
	const firstDependency = document.querySelector("[role='dialog'] a[href^='/tasks/TASK-1/']");
	assert.ok(
		firstDependency,
		`Task 2 links: ${[...document.querySelectorAll("[role='dialog'] a[href]")].map((link) => link.getAttribute("href")).join(", ")}`,
	);
	click(firstDependency);
	await waitFor(() => document.querySelector("#modal-title")?.textContent.includes("TASK-1 — Task 1 日本語"));
	assert.equal(document.querySelectorAll("[role='dialog'] script, [role='dialog'] img").length, 0);
	assert.equal(document.querySelectorAll("[role='dialog'] a[href^='javascript:']").length, 0);
	click(document.querySelector("[role='dialog'] button[aria-label='Close modal']"));
	await waitFor(() => document.querySelector("[role='dialog']") === null);
	setInput(query, `Task ${count} 日本語`);
	await waitFor(() => document.querySelectorAll("[data-snapshot-list] tbody tr").length === 1);
	click([...document.querySelectorAll("[data-snapshot-list] tbody tr button")].find((item) => item.textContent === `TASK-${count}`));
	await waitFor(() => document.querySelector("#modal-title")?.textContent.includes(`TASK-${count} — Task ${count} 日本語`));
	assert.doesNotMatch(document.querySelector("[role='dialog']").textContent, /Score/);
	click(button("Edit task JSON"));
	await waitFor(() => document.querySelector("textarea[aria-label='Task JSON']"));
	const editor = document.querySelector("textarea[aria-label='Task JSON']");
	const proposal = JSON.parse(editor.value);
	proposal.title = `Reviewed task ${count} 日本語 </script><script>window.__reviewInjected=true</script>`;
	Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set.call(editor, JSON.stringify(proposal));
	editor.dispatchEvent(new Event("input", { bubbles: true }));
	click(button("Save proposal"));
	await waitFor(() => document.querySelector("textarea[aria-label='Task JSON']") === null);
	click(button("Save HTML copy"));
	await waitFor(() => savedHtml.includes("proposedEdits"));
	const revised = new JSDOM(savedHtml, { url: `file://${path}-reviewed`, runScripts: "outside-only", beforeParse(window) {
		window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
		window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
		window.cancelAnimationFrame = clearTimeout;
		window.fetch = () => { throw new Error("Reviewed copy attempted fetch"); };
	} });
	const revisedData = JSON.parse(revised.window.document.querySelector("#backlog-snapshot").textContent);
	assert.equal(revisedData.tasks[count - 1].title, `Task ${count} 日本語`);
	assert.equal(revisedData.proposedEdits[`TASK-${count}`].task.title, proposal.title);
	assert.equal(revised.window.document.querySelectorAll("script").length, 2);
	revised.window.eval(revised.window.document.querySelector("script:not([type])").textContent);
	for (let attempt = 0; attempt < 40 && !revised.window.document.getElementById("root").textContent.includes("1 proposed edit"); attempt++) await new Promise((resolve) => setTimeout(resolve, 25));
	assert.match(revised.window.document.getElementById("root").textContent, /1 proposed edit/);
	assert.equal(revised.window.__reviewInjected, undefined);
	revised.window.close();
	assert.equal(requests, 0);
	assert.equal(dom.window.__injected, undefined);
	assert.equal(document.querySelectorAll("script").length, 2);
	assert.deepEqual(errors, []);
	console.log(JSON.stringify({ count, startupMs, listMs, searchMs, detailMs, requests }));
} finally {
	dom.window.close();
}
