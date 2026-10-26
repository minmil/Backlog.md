import type React from "react";

type Props = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "className"> & {
	minWidthClass?: string;
};

/** One native select treatment for schema, task-list, and board filters. */
export default function FilterSelect({ minWidthClass = "min-w-[140px]", ...props }: Props): React.ReactElement {
	return (
		<span className="relative inline-flex">
			<select
				{...props}
				className={`${minWidthClass} h-10 appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-10 text-sm text-gray-900 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-stone-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:ring-stone-400`}
			/>
			<svg aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-500 dark:text-gray-400" viewBox="0 0 12 12" fill="none">
				<path d="m2 4 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		</span>
	);
}
