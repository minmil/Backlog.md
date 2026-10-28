import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { getDefaultTaskSchema } from "../schema/default-schema.ts";
import type { Task } from "../types/index.ts";
import TaskCard from "../web/components/TaskCard.tsx";
import TaskList from "../web/components/TaskList.tsx";
import LanguageToggle from "../web/components/schema/LanguageToggle.tsx";
import { DisplayLanguageProvider } from "../web/components/schema/DisplayLanguageContext.tsx";
import { SchemaProvider } from "../web/components/schema/SchemaProvider.tsx";
import SchemaSidebar from "../web/components/schema/SchemaSidebar.tsx";
import SchemaSections from "../web/components/schema/SchemaSections.tsx";
import { ThemeProvider } from "../web/contexts/ThemeContext.tsx";
import TaskDetailsModal from "../web/components/TaskDetailsModal.tsx";

function schema() {
	const value = structuredClone(getDefaultTaskSchema());
	value.fields.title = { ...value.fields.title!, lang: "en" };
	value.fields.title_ja = { type: "text", label: "Title", lang: "ja", translation_of: "title" };
	value.sections.description = { ...value.sections.description!, lang: "en" };
	value.sections.description_ja = { kind: "markdown", title: "Description", lang: "ja", translation_of: "description" };
	return value;
}

const tasks: Task[] = [
	{ id: "TASK-1", title: "Alpha", status: "To Do", assignee: [], labels: [], dependencies: [], createdDate: "2026-01-01", fieldValues: { title_ja: "ゼータ" } },
	{ id: "TASK-2", title: "Beta", status: "To Do", assignee: [], labels: [], dependencies: [], createdDate: "2026-01-01", fieldValues: { title_ja: "アイ" } },
	{ id: "TASK-3", title: "Untranslated", status: "To Do", assignee: [], labels: [], dependencies: [], createdDate: "2026-01-01" },
];

let root: Root | undefined;
function mount(ui: React.ReactNode, url = "/board", initialSchema = schema(), storedLang?: string) {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: `http://localhost${url}` });
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.window = dom.window as unknown as Window & typeof globalThis;
	globalThis.document = dom.window.document as unknown as Document;
	globalThis.navigator = dom.window.navigator as unknown as Navigator;
	globalThis.localStorage = dom.window.localStorage as unknown as Storage;
	if (storedLang) localStorage.setItem("backlog-display-language", storedLang);
	globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0) as unknown as number;
	globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
	const element = document.getElementById("root") as HTMLElement;
	root = createRoot(element);
	act(() => root?.render(<MemoryRouter initialEntries={[url]}><ThemeProvider><SchemaProvider initialSchema={initialSchema}><DisplayLanguageProvider>{ui}</DisplayLanguageProvider></SchemaProvider></ThemeProvider></MemoryRouter>));
	return element;
}

function Path() {
	const location = useLocation();
	return <span data-path>{`${location.pathname}${location.search}`}</span>;
}

afterEach(() => { if (root) act(() => root?.unmount()); root = undefined; });

describe("web display language", () => {
	it("hides the toggle when the schema has one language", () => {
		const one = getDefaultTaskSchema();
		const element = mount(<LanguageToggle />, "/board", one);
		expect(element.querySelector('[aria-label="Display language"]')).toBeNull();
	});

	it("uses URL language before storage and preserves filters while switching", () => {
		const element = mount(<><LanguageToggle /><Path /><TaskCard task={tasks[0]!} onUpdate={() => {}} onEdit={() => {}} /></>, "/board?status=To%20Do&lang=ja", schema(), "en");
		expect(element.querySelector("h4")?.textContent).toBe("ゼータ");
		expect(new URLSearchParams(element.querySelector("[data-path]")?.textContent?.split("?")[1]).get("status")).toBe("To Do");
		act(() => (element.querySelector('[aria-label="Display language"] button[aria-pressed="false"]') as HTMLButtonElement).click());
		expect(element.querySelector("h4")?.textContent).toBe("Alpha");
		expect(new URLSearchParams(element.querySelector("[data-path]")?.textContent?.split("?")[1]).get("status")).toBe("To Do");
		expect(element.querySelector("[data-path]")?.textContent).toContain("lang=en");
	});

	it("shows fallback code, orders translations in view, and keeps both in edit", () => {
		const values = { title: "Untranslated", title_ja: "" };
		const sections = { description: "English content", description_ja: "" };
		const element = mount(<><TaskCard task={tasks[2]!} onUpdate={() => {}} onEdit={() => {}} /><SchemaSidebar values={values} onChange={() => {}} mode="view" /><SchemaSections values={sections} mode="view" onChange={() => {}} /></>, "/board?lang=ja");
		expect(element.querySelector("h4")?.textContent).toContain("EN");
		expect(element.textContent).toContain("English content");
		act(() => root?.render(<MemoryRouter initialEntries={["/board?lang=ja"]}><ThemeProvider><SchemaProvider initialSchema={schema()}><DisplayLanguageProvider><SchemaSidebar values={{ title: "Alpha", title_ja: "アイ" }} onChange={() => {}} mode="edit" /><SchemaSections values={{ description: "English", description_ja: "Japanese" }} mode="edit" onChange={() => {}} /></DisplayLanguageProvider></SchemaProvider></ThemeProvider></MemoryRouter>));
		expect(element.querySelectorAll('input, textarea').length).toBeGreaterThan(1);
	});

	it("sorts list titles using displayed Japanese values", () => {
		const element = mount(<TaskList tasks={tasks.slice(0, 2)} availableStatuses={["To Do"]} availableLabels={[]} availableMilestones={[]} milestoneEntities={[]} archivedMilestones={[]} onEditTask={() => {}} onNewTask={() => {}} />, "/tasks?lang=ja");
		const titleHeader = [...element.querySelectorAll("thead button")].find((button) => button.textContent?.includes("Title")) as HTMLButtonElement;
		act(() => titleHeader.click());
		expect([...element.querySelectorAll("tbody tr button")].map((button) => button.textContent).filter((value) => value === "アイ" || value === "ゼータ")).toEqual(["アイ", "ゼータ"]);
	});

	it("switches board, list, and modal titles together", () => {
		const element = mount(<><LanguageToggle /><TaskCard task={tasks[0]!} onUpdate={() => {}} onEdit={() => {}} /><TaskList tasks={tasks.slice(0, 1)} availableStatuses={["To Do"]} availableLabels={[]} availableMilestones={[]} milestoneEntities={[]} archivedMilestones={[]} onEditTask={() => {}} onNewTask={() => {}} /><TaskDetailsModal task={tasks[0]!} isOpen onClose={() => {}} /></>, "/tasks?lang=en");
		expect(element.querySelector("h4")?.textContent).toBe("Alpha");
		act(() => (element.querySelector('[aria-label="Display language"] button[aria-pressed="false"]') as HTMLButtonElement).click());
		expect(element.querySelector("h4")?.textContent).toBe("ゼータ");
		expect(element.querySelector("tbody")?.textContent).toContain("ゼータ");
		expect(element.querySelector("#modal-title")?.textContent).toContain("ゼータ");
	});
});
