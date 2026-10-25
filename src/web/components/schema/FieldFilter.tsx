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

export default function FieldFilter({ fieldKey, value, onChange, options }: Props): React.ReactElement | null {
	const { schema } = useSchema();
	const field = schema.fields[fieldKey];
	if (!field || field.hidden) return null;
	const label = field.label ?? fieldKey;
	const choices = options ?? (field.type === "user" || field.type === "user-list" ? schema.users.map((user) => user.handle) : field.values ?? []);
	if (fieldKey === "assignee" && field.type === "user-list") {
		return <select aria-label="Filter board by assignee" className={CONTROL_CLASS} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value || null)}><option value="">All assignees</option><option value="__unassigned__">Unassigned</option>{choices.map((choice) => <option key={choice} value={choice}>{schema.users.find((user) => user.handle === choice)?.name ?? choice}</option>)}</select>;
	}
	if (field.type === "multi-enum" || field.type === "string-list" || field.type === "user-list") {
		return <LabelFilterDropdown menuId={fieldKey === "labels" ? "board-labels-filter-menu" : `schema-filter-${fieldKey}`} label={label} availableLabels={choices} selectedLabels={Array.isArray(value) ? value : []} onChange={(items) => onChange(items.length ? items : null)} className="min-w-[200px]" />;
	}
	if (field.type === "enum" || field.type === "user" || field.type === "milestone-ref") {
		return (
			<select aria-label={`Filter board by ${label.toLowerCase()}`} className={CONTROL_CLASS} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value || null)}>
				<option value="">All {fieldKey === "priority" ? "priorities" : fieldKey === "type" ? "types" : fieldKey === "project" ? "projects" : `${label.toLowerCase()}s`}</option>
				{choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
			</select>
		);
	}
	if (field.type === "bool") {
		return (
			<select aria-label={`Filter ${label}`} className={CONTROL_CLASS} value={value === null || value === undefined ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? null : event.target.value === "true")}>
				<option value="">All {label.toLowerCase()}</option><option value="true">Yes</option><option value="false">No</option>
			</select>
		);
	}
	if (field.type === "date" || field.type === "datetime" || field.type === "number") {
		return <input aria-label={`Filter ${label}`} className={CONTROL_CLASS} type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"} value={value === null || value === undefined ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? null : field.type === "number" ? Number(event.target.value) : event.target.value)} />;
	}
	return null;
}
