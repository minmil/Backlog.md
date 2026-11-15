import type { ReactNode } from "react";

interface Props {
	children: ReactNode;
	summary: ReactNode;
	sectionKey?: string;
	className?: string;
}

export default function CollapsibleSection({ children, summary, sectionKey, className = "" }: Props) {
	return <details key={sectionKey} className={`group mb-4 rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 ${className}`}>
		<summary className="flex cursor-pointer list-none items-center gap-3 overflow-x-auto whitespace-nowrap px-4 py-3 text-sm text-gray-900 marker:hidden dark:text-gray-100">
			{summary}
			<svg className="ml-2 h-4 w-4 shrink-0 text-gray-500 transition-transform group-open:rotate-180 dark:text-gray-400" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" /></svg>
		</summary>
		<div className="space-y-4 border-t border-gray-200 px-4 py-3 dark:border-gray-700">{children}</div>
	</details>;
}
