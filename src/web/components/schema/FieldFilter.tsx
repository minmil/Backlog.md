import type React from "react";
import type { FieldValue as RegistryFieldValue } from "../../../schema/field-registry.ts";
import LabelFilterDropdown from "../LabelFilterDropdown.tsx";
import { useSchema } from "./SchemaProvider.tsx";

interface Props {
	fieldKey: string;
	value: RegistryFieldValue | null | undefined;
	onChange: (value: RegistryFieldValue | null) => void;
	options?: string[];
}

const CONTROL_CLASS = "min-w-[140px] h-10 py-2 px-3 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-stone-500 dark:focus:ring-stone-400 transition-colors duration-200";
const SELECT_CLASS = "min-w-[140px] h-10 py-2 pl-3 pr-10 appearance-none text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-stone-500 dark:focus:ring-stone-400 transition-colors duration-200";

function FilterSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>): React.ReactElement {
	return (
		<span className="relative inline-flex">
			<select {...props} className={SELECT_CLASS} />
			<svg aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-500 dark:text-gray-400" viewBox="0 0 12 12" fill="none">
				<path d="m2 4 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		</span>
	);
}

export default function FieldFilter({ fieldKey, value, onChange, options }: Props): React.ReactElement | null {
	const { schema } = useSchema();
	const field = schema.fields[fieldKey];
	if (!field || field.hidden) return null;
	const label = field.label ?? fieldKey;
	const choices = options ?? (field.type === "user" || field.type === "user-list" ? schema.users.map((user) => user.handle) : field.values ?? []);
	if (fieldKey === "assignee" && field.type === "user-list") {
		return <FilterSelect aria-label="Filter board by assignee" value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value || null)}><option value="">All assignees</option><option value="__unassigned__">Unassigned</option>{choices.map((choice) => <option key={choice} value={choice}>{schema.users.find((user) => user.handle === choice)?.name ?? choice}</option>)}</FilterSelect>;
	}
	if (field.type === "multi-enum" || field.type === "string-list" || field.type === "user-list") {
		return <LabelFilterDropdown menuId={fieldKey === "labels" ? "board-labels-filter-menu" : `schema-filter-${fieldKey}`} label={label} availableLabels={choices} selectedLabels={Array.isArray(value) ? value : []} onChange={(items) => onChange(items.length ? items : null)} className="min-w-[200px]" />;
	}
	if (field.type === "enum" || field.type === "user" || field.type === "milestone-ref") {
		return (
			<FilterSelect aria-label={`Filter board by ${label.toLowerCase()}`} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value || null)}>
				<option value="">All {fieldKey === "priority" ? "priorities" : fieldKey === "type" ? "types" : fieldKey === "project" ? "projects" : `${label.toLowerCase()}s`}</option>
				{choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
			</FilterSelect>
		);
	}
	if (field.type === "bool") {
		return (
			<FilterSelect aria-label={`Filter ${label}`} value={value === null || value === undefined ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? null : event.target.value === "true")}>
				<option value="">All {label.toLowerCase()}</option><option value="true">Yes</option><option value="false">No</option>
			</FilterSelect>
		);
	}
	if (field.type === "date" || field.type === "datetime" || field.type === "number") {
		return <input aria-label={`Filter ${label}`} className={CONTROL_CLASS} type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"} value={value === null || value === undefined ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? null : field.type === "number" ? Number(event.target.value) : event.target.value)} />;
	}
	return null;
}
