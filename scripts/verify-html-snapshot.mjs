import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";

const path = process.argv[2];
if (!path) throw new Error("Usage: node scripts/verify-html-snapshot.mjs <snapshot.html> <task-count>");
const count = Number(process.argv[3] ?? 100);
const html = await readFile(path, "utf8");
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => errors.push(error.message));
virtualConsole.on("error", (message) => errors.push(String(message)));
let networkRequests = 0;
let sockets = 0;
let savedHtml = "";

const createViewer = (source, url) => new JSDOM(source, {
	url,
	runScripts: "outside-only",
	virtualConsole,
	beforeParse(window) {
		window.Response = Response;
		window.Request = Request;
		window.Headers = Headers;
		window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
		window.confirm = (message) => { errors.push(`unexpected confirm: ${message}`); return true; };
		window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
		window.cancelAnimationFrame = clearTimeout;
		window.Blob = class { constructor(parts) { this.parts = parts; } };
		window.URL.createObjectURL = (blob) => { savedHtml = blob.parts.join(""); return "blob:review-copy"; };
		window.URL.revokeObjectURL = () => {};
		window.HTMLAnchorElement.prototype.click = function () { if (!this.download) throw new Error("Unexpected anchor click"); };
		window.fetch = () => { networkRequests++; throw new Error("Network fetch attempted"); };
		window.WebSocket = class { constructor() { sockets++; throw new Error("WebSocket attempted"); } };
	},
});

const waitFor = async (document, check) => {
	for (let attempt = 0; attempt < 400; attempt++) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`Timed out: ${document.getElementById("root")?.textContent?.slice(0, 400)}; errors: ${errors.join(" | ").slice(0, 1000)}`);
};
const click = (window, element) => {
	assert.ok(element, "Expected clickable element");
	element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
};
const button = (document, label) => [...document.querySelectorAll("button")].find((element) => element.textContent.trim() === label);
const setInput = (window, element, value) => {
	assert.ok(element, "Expected input");
	Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(element, value);
	element.dispatchEvent(new window.Event("input", { bubbles: true }));
};
const start = async (dom) => {
	const { document } = dom.window;
	assert.equal(document.querySelectorAll("script").length, 2);
	assert.equal(document.querySelectorAll("script[src],link[href],iframe,object,embed").length, 0);
	assert.match(document.querySelector("meta[http-equiv='Content-Security-Policy']")?.content ?? "", /connect-src 'none'/);
	assert.doesNotMatch(document.querySelector("style")?.textContent ?? "", /@import|url\(\s*['"]?https?:/i);
	dom.window.eval(document.querySelector("script:not([type])").textContent);
	await waitFor(document, () => Boolean(button(document, "Save changes")) && document.body.textContent.includes(`Tasks (${count})`));
};

const dom = createViewer(html, `file://${path}`);
try {
	const { document } = dom.window;
	await start(dom);
	assert.match(document.body.textContent, /Snapshot 日本語/);
	assert.ok(document.querySelector("a[href='/board']"), "Live board navigation is present");
	assert.ok(document.querySelector("a[href='/tasks']"), "Live task list navigation is present");
	assert.ok(document.querySelector("[role='button'][aria-label^='Open TASK-']"), "Live task cards are present");
	assert.ok(document.querySelector("[draggable='true']"), "Task cards retain the live drag affordance");
	assert.equal(dom.window.__injected, undefined);
	if (count <= 500) {
	click(dom.window, document.querySelector("[role='button'][aria-label^='Open TASK-3:']"));
	await waitFor(document, () => document.querySelector("[role='dialog']")?.textContent.includes("TASK-3 — Task 3 日本語"));
	await new Promise((resolve) => setTimeout(resolve, 100));
	const taskLink = document.querySelector("[role='dialog'] a[href^='/board/TASK-2/']");
	assert.ok(taskLink, "Task links are available in the live detail modal");
	click(dom.window, taskLink);
	await waitFor(document, () => document.querySelector("[role='dialog']")?.textContent.includes("TASK-2 — Task 2 日本語"));
	click(dom.window, document.querySelector("[role='dialog'] button[aria-label='Close modal']"));
	click(dom.window, document.querySelector("a[href='/tasks']"));
	await waitFor(document, () => document.body.textContent.includes(`Showing ${count} of ${count} tasks`));
	const row = [...document.querySelectorAll("tbody tr")].find((item) => item.textContent.includes(`TASK-${count}`));
	click(dom.window, row);
	await waitFor(document, () => document.querySelector("[role='dialog']")?.textContent.includes(`TASK-${count} — Task ${count} 日本語`));
	await new Promise((resolve) => setTimeout(resolve, 100));
	click(dom.window, [...document.querySelectorAll("[role='dialog'] button")].find((item) => item.textContent.trim() === "Edit"));
	await waitFor(document, () => Boolean(document.querySelector("input#schema-field-title")));
	const proposedTitle = `Reviewed task ${count} 日本語 </script><script>window.__reviewInjected=true</script>`;
	setInput(dom.window, document.querySelector("input#schema-field-title"), proposedTitle);
	setInput(dom.window, document.querySelector("input#schema-field-custom_score"), "77");
	const status = document.querySelector("select#schema-field-status");
	status.value = "In Progress";
	status.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
	await new Promise((resolve) => setTimeout(resolve, 100));
	click(dom.window, button(document, "Save"));
	await waitFor(document, () => document.querySelector("[role='dialog']")?.textContent.includes("Reviewed task"));
	click(dom.window, document.querySelector("[role='dialog'] button[aria-label='Close modal']"));
	click(dom.window, button(document, "Save changes"));
	await waitFor(document, () => savedHtml.includes("proposedEdits"));
	const revised = createViewer(savedHtml, `file://${path}-reviewed`);
	try {
		const data = JSON.parse(revised.window.document.querySelector("#backlog-snapshot").textContent);
		assert.equal(data.tasks[count - 1].title, `Task ${count} 日本語`);
		assert.equal(data.proposedEdits[`TASK-${count}`].task.title, proposedTitle);
		assert.equal(data.proposedEdits[`TASK-${count}`].task.status, "In Progress");
		assert.equal(data.proposedEdits[`TASK-${count}`].task.fieldValues.custom_score, 77);
		await start(revised);
		assert.equal(revised.window.__reviewInjected, undefined);
	} finally {
		revised.window.close();
	}
	}
	assert.equal(networkRequests, 0);
	assert.equal(sockets, 0);
	assert.deepEqual(errors, []);
	console.log(JSON.stringify({ count, networkRequests, sockets }));
} finally {
	dom.window.close();
}
