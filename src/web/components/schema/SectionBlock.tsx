import MDEditor from "@uiw/react-md-editor";
import { useState, type ReactElement } from "react";
import type { ChecklistItem, LogEntry, LogInput, SectionValue } from "../../../markdown/sections.ts";
import AcceptanceCriteriaEditor from "../AcceptanceCriteriaEditor.tsx";
import MermaidMarkdown from "../MermaidMarkdown.tsx";
import { useTheme } from "../../contexts/ThemeContext.tsx";
import { useSchema } from "./SchemaProvider.tsx";
import LanguagePill from "./LanguagePill.tsx";
import SelectControl from "../SelectControl.tsx";
import { FallbackLanguageCode } from "./DisplayLanguageContext.tsx";
import LogEntryRow, { logRowGridClass } from "./LogEntryRow.tsx";

interface Props {
	sectionId: string;
	value: SectionValue | undefined;
	mode: "view" | "edit";
	onChange?: (value: string | ChecklistItem[]) => void;
	onToggleChecklist?: (index: number, checked: boolean) => void | Promise<void>;
	checklistBusy?: boolean;
	readOnly?: boolean;
	onAppendLog?: (entry: LogInput) => void | Promise<void>;
	onLogDraftChange?: (hasDraft: boolean) => void;
	onLogSaved?: () => void;
	logFormId?: string;
	logSaveInHeader?: boolean;
	fallbackLang?: string;
	bare?: boolean;
}

export default function SectionBlock({ sectionId, value, mode, onChange, onToggleChecklist, checklistBusy, readOnly, onAppendLog, onLogDraftChange, onLogSaved, logFormId, logSaveInHeader = false, fallbackLang, bare = false }: Props): ReactElement | null {
	const { schema } = useSchema();
	const { theme } = useTheme();
	const section = schema.sections[sectionId];
	const [author, setAuthor] = useState(() => schema.users.find((user) => user.default)?.handle ?? schema.users[0]?.handle ?? "");
	const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
	const [body, setBody] = useState("");
	const [appendError, setAppendError] = useState<string | null>(null);
	const [savingLog, setSavingLog] = useState(false);
	const saveLog = async () => {
		if (savingLog || !body.trim() || !author || !onAppendLog) return;
		setSavingLog(true);
		try {
			await onAppendLog({ author, date, body: body.trim() });
			setBody("");
			onLogDraftChange?.(false);
			setAppendError(null);
			onLogSaved?.();
		} catch (error) {
			setAppendError(error instanceof Error ? error.message : String(error));
		} finally {
			setSavingLog(false);
		}
	};
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
			<ul className="space-y-2">{items.map((item) => <li key={item.index} className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100"><input type="checkbox" checked={item.checked} disabled={readOnly || checklistBusy || !onToggleChecklist} aria-label={item.text} onChange={(event) => void onToggleChecklist?.(item.index, event.target.checked)} className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded" /><span>{item.text}</span></li>)}</ul>
		);
	} else {
		const entries = Array.isArray(value) ? value.filter((item): item is LogEntry => "body" in item) : [];
		content = (
			<div className={bare ? "" : "space-y-4"}>
				{mode === "edit" ? <form id={logFormId} onSubmit={(event) => { event.preventDefault(); void saveLog(); }} className={logRowGridClass}>
					<div className="min-w-0 space-y-2 py-2 pr-3">
						<input aria-label="Log date" type="date" className="w-full min-w-0 rounded-md border border-gray-300 bg-white px-1 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100" value={date} onChange={(event) => setDate(event.target.value)} />
						<SelectControl aria-label="Log author" className="w-full" minWidthClass="w-full" triggerClassName="!h-8 !pl-2 !pr-5 !py-1 !text-[11px]" chevronClassName="!right-2" value={author} onChange={(event) => setAuthor(event.target.value)}>{schema.users.map((user) => <option key={user.handle} value={user.handle}>{user.handle}</option>)}</SelectControl>
					</div>
					<div className="min-w-0 border-l border-gray-300 py-2 pl-4 dark:border-gray-600">
						<textarea aria-label="Log entry" value={body} onChange={(event) => { setBody(event.target.value); onLogDraftChange?.(Boolean(event.target.value.trim())); }} className="min-h-20 w-full resize-y rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100" />
						{appendError ? <p role="alert" className="text-xs text-red-600 dark:text-red-400">{appendError}</p> : null}
						{!logSaveInHeader && <div className="mt-2 flex justify-end"><button type="submit" disabled={!body.trim() || !author || !onAppendLog || savingLog} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-700 dark:hover:bg-blue-600">{savingLog ? "Saving…" : "Save"}</button></div>}
					</div>
				</form> : null}
				{entries.map((entry, index) => bare
					? <LogEntryRow key={`${entry.createdAt}-${index}`} entry={entry} />
					: <div key={`${entry.createdAt}-${index}`} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3"><div className="text-xs text-gray-500 dark:text-gray-400">{entry.author} · {entry.date}</div><div className="prose prose-sm !max-w-none wmde-markdown" data-color-mode={theme}><MermaidMarkdown source={entry.body} /></div></div>)}
			</div>
		);
	}
	if (bare) return <div>{content}</div>;
	return <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"><h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100"><span>{title}</span>{section.lang ? <LanguagePill lang={section.lang} /> : null}</h2>{content}{fallbackLang ? <FallbackLanguageCode lang={fallbackLang} /> : null}</section>;
}
