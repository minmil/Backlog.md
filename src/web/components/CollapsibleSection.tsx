import type { ReactNode } from "react";

interface Props {
	children: ReactNode;
	summary: ReactNode;
	sectionKey?: string;
	className?: string;
	variant?: "standard" | "notebook";
}

export default function CollapsibleSection({ children, summary, sectionKey, className = "", variant = "standard" }: Props) {
	const notebook = variant === "notebook";
	return <details key={sectionKey} className={`group mb-4 ${notebook ? "" : "rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"} ${className}`}>
		<summary className={`${notebook ? "relative block py-2 pr-8" : "flex items-center gap-3 overflow-x-auto whitespace-nowrap px-4 py-3 pr-10"} cursor-pointer list-none text-sm text-gray-900 marker:hidden dark:text-gray-100`}>
			{summary}
			<svg className={`${notebook ? "absolute right-1 top-2" : "ml-2"} h-4 w-4 shrink-0 text-gray-500 transition-transform group-open:rotate-90 dark:text-gray-400`} aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m9 18 6-6-6-6" /></svg>
		</summary>
		<div className={notebook ? "max-h-[40vh] overflow-y-auto" : "space-y-4 border-t border-gray-200 px-4 py-3 dark:border-gray-700"}>{children}</div>
	</details>;
}
