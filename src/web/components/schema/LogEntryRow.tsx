import type { LogEntry } from "../../../markdown/sections.ts";
import { useTheme } from "../../contexts/ThemeContext.tsx";
import MermaidMarkdown from "../MermaidMarkdown.tsx";

export default function LogEntryRow({ entry, preview = false }: { entry: LogEntry; preview?: boolean }) {
	const { theme } = useTheme();
	return <div className="grid grid-cols-[8rem_minmax(0,1fr)] text-left sm:grid-cols-[10rem_minmax(0,1fr)]">
		<div className="min-w-0 py-2 pr-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
			<div>{entry.date}</div>
			<div className="truncate" title={entry.author}>{entry.author}</div>
		</div>
		<div className="min-w-0 border-l border-gray-300 py-2 pl-4 text-sm text-gray-900 dark:border-gray-600 dark:text-gray-100">
			{preview
				? <div className="line-clamp-2 whitespace-pre-wrap break-words">{entry.body}</div>
				: <div className="prose prose-sm !max-w-none wmde-markdown [&_p]:my-0 [&_ul]:my-0 [&_ol]:my-0" data-color-mode={theme}><MermaidMarkdown source={entry.body} /></div>}
		</div>
	</div>;
}
