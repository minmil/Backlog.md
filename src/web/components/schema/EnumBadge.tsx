import type React from "react";

const PALETTES = [
	"bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
	"bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
	"bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
	"bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
	"bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
	"bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
	"bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300",
	"bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
] as const;

const DEFAULT_TYPE_INDICES: Record<string, number> = {
	bug: 0,
	feature: 1,
	enhancement: 2,
	task: 3,
	chore: 4,
	docs: 5,
	spike: 6,
};

export default function EnumBadge({
	fieldKey,
	value,
	options = [],
	className = "",
}: {
	fieldKey: string;
	value: string;
	options?: string[];
	className?: string;
}): React.ReactElement | null {
	if (!value.trim()) return null;
	const configuredIndex = options.findIndex((option) => option.toLowerCase() === value.toLowerCase());
	const index = fieldKey === "type" && DEFAULT_TYPE_INDICES[value.toLowerCase()] !== undefined
		? DEFAULT_TYPE_INDICES[value.toLowerCase()]
		: configuredIndex >= 0
			? configuredIndex % PALETTES.length
			: [...value.toLowerCase()].reduce((hash, letter) => (hash * 31 + letter.charCodeAt(0)) >>> 0, 0) % PALETTES.length;
	return (
		<span
			data-field={fieldKey}
			title={`${fieldKey}: ${value}`}
			className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[10px] font-semibold leading-4 ${PALETTES[index ?? 0]} ${className}`}
		>
			<span className="truncate">{value}</span>
		</span>
	);
}
