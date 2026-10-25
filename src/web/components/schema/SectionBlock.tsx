import MDEditor from "@uiw/react-md-editor";
import { useState, type ReactElement } from "react";
import type { ChecklistItem, LogEntry, LogInput, SectionValue } from "../../../markdown/sections.ts";
import AcceptanceCriteriaEditor from "../AcceptanceCriteriaEditor.tsx";
import MermaidMarkdown from "../MermaidMarkdown.tsx";
import { useTheme } from "../../contexts/ThemeContext.tsx";
import { useSchema } from "./SchemaProvider.tsx";

interface Props {
	sectionId: string;
	value: SectionValue | undefined;
	mode: "view" | "edit";
	onChange?: (value: string | ChecklistItem[]) => void;
	onAppendLog?: (entry: LogInput) => void;
}

export default function SectionBlock({ sectionId, value, mode, onChange, onAppendLog }: Props): ReactElement | null {
	const { schema } = useSchema();
	const { theme } = useTheme();
	const section = schema.sections[sectionId];
	const [author, setAuthor] = useState(() => schema.users.find((user) => user.default)?.handle ?? schema.users[0]?.handle ?? "");
	const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
	const [body, setBody] = useState("");
	if (!section) return null;
	const title = section.title;
	let content: ReactElement | null = null;
	if (section.kind === "markdown") {
		const text = typeof value === "string" ? value : "";
		content = mode === "view" ? (
			text ? <div className="prose prose-sm !max-w-none wmde-markdown" data-color-mode={theme}><MermaidMarkdown source={text} /></div> : <p className="text-sm text-gray-500 dark:text-gray-400">No {title.toLowerCase()}</p>
		) : (
			<div className="border border-gray-200 dark:border-gray-700 rounded-md"><MDEditor value={text} onChange={(next) => onChange?.(next ?? "")} preview="edit" height={320} data-color-mode={theme} /></div>
		);
	} else if (section.kind === "checklist") {
		const items = Array.isArray(value) ? value.filter((item): item is ChecklistItem => "checked" in item) : [];
		content = mode === "edit" ? (
			<AcceptanceCriteriaEditor criteria={items} onChange={(next) => onChange?.(next)} label="" />
		) : (
			<ul className="space-y-2">{items.map((item) => <li key={item.index} className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100"><input type="checkbox" checked={item.checked} disabled className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded" /><span>{item.text}</span></li>)}</ul>
		);
	} else {
		const entries = Array.isArray(value) ? value.filter((item): item is LogEntry => "body" in item) : [];
		content = (
			<div className="space-y-4">
				{entries.map((entry) => <div key={entry.createdAt} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3"><div className="text-xs text-gray-500 dark:text-gray-400">{entry.author} · {entry.date}</div><div className="prose prose-sm !max-w-none wmde-markdown" data-color-mode={theme}><MermaidMarkdown source={entry.body} /></div></div>)}
				{mode === "edit" ? <div className="space-y-2">
					<div className="flex gap-2"><select aria-label="Log author" className="w-full h-10 px-3 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" value={author} onChange={(event) => setAuthor(event.target.value)}>{schema.users.map((user) => <option key={user.handle} value={user.handle}>{user.name}</option>)}</select><input aria-label="Log date" type="date" className="w-full h-10 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" value={date} onChange={(event) => setDate(event.target.value)} /></div>
					<textarea aria-label="Log entry" value={body} onChange={(event) => setBody(event.target.value)} className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
					<button type="button" disabled={!body.trim() || !author} onClick={() => { onAppendLog?.({ author, date, body: body.trim() }); setBody(""); }} className="px-2 py-1 text-sm bg-blue-500 dark:bg-blue-600 text-white rounded-md hover:bg-blue-600 dark:hover:bg-blue-700">Add</button>
				</div> : null}
			</div>
		);
	}
	return <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"><h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{title}</h2>{content}</section>;
}
