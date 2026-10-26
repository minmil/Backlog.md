import type React from "react";
import type { FieldValue as RegistryFieldValue } from "../../../schema/field-registry.ts";
import type { Milestone, Task } from "../../../types/index.ts";
import ChipInput from "../ChipInput.tsx";
import DependencyInput from "../DependencyInput.tsx";
import FieldValue from "./FieldValue.tsx";
import { useSchema } from "./SchemaProvider.tsx";
import LanguagePill from "./LanguagePill.tsx";

interface Props {
	fieldKey: string;
	value: RegistryFieldValue | null | undefined;
	onChange: (value: RegistryFieldValue | null) => void;
	error?: string;
	availableTasks?: Task[];
	milestones?: Milestone[];
}

const INPUT_CLASS = "w-full h-10 px-3 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-stone-500 dark:focus:ring-stone-400 focus:border-transparent transition-colors duration-200";

export default function FieldInput({ fieldKey, value, onChange, error, availableTasks, milestones }: Props): React.ReactElement | null {
	const { schema } = useSchema();
	const field = schema.fields[fieldKey];
	if (!field || field.hidden) return null;
	const label = field.label ?? fieldKey;
	const inputId = `schema-field-${fieldKey}`;
	const errorId = `${inputId}-error`;
	const current = value ?? "";
	let control: React.ReactNode;
	if (field.managed || field.type === "sequence") {
		control = <FieldValue fieldKey={fieldKey} value={value} variant="detail" />;
	} else if (field.type === "bool") {
		control = (
			<input id={inputId} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded" />
		);
	} else if (field.type === "milestone-ref" && milestones) {
		control = <select id={inputId} className={INPUT_CLASS} value={String(current)} onChange={(event) => onChange(event.target.value || null)}>
			<option value="">No milestone</option>
			{current && !milestones.some((milestone) => milestone.id === current) ? <option value={String(current)}>{String(current)}</option> : null}
			{milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}
		</select>;
	} else if (field.type === "enum" || (field.type === "user" && schema.users.length > 0)) {
		const options = field.type === "user" ? schema.users.map((user) => user.handle) : field.values ?? [];
		control = (
			<select id={inputId} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} className={INPUT_CLASS} value={String(current)} onChange={(event) => onChange(event.target.value || null)}>
				<option value="">No {label.toLowerCase()}</option>
				{current && !options.includes(String(current)) ? <option value={String(current)}>{String(current)} (not configured)</option> : null}
				{options.map((option) => <option key={option} value={option}>{field.type === "user" ? schema.users.find((user) => user.handle === option)?.name ?? option : option}</option>)}
			</select>
		);
	} else if (field.type === "multi-enum" || field.type === "string-list" || field.type === "user-list" || field.type === "task-ref-list") {
		const items = Array.isArray(value) ? value : [];
		control = field.type === "task-ref-list" && availableTasks ? (
			<DependencyInput value={items} onChange={onChange} availableTasks={availableTasks} label="" />
		) : (
			<ChipInput name={fieldKey} label="" value={items} onChange={onChange} placeholder={`Add ${label.toLowerCase()} and press Enter`} />
		);
	} else {
		const inputType = field.type === "date" ? "date" : field.type === "number" ? "number" : "text";
		control = (
			<input
				id={inputId}
				type={inputType}
				step={field.type === "number" ? "any" : undefined}
				value={String(current)}
				aria-invalid={Boolean(error)}
				aria-describedby={error ? errorId : undefined}
				className={INPUT_CLASS}
				onChange={(event) => {
					const next = event.target.value;
					onChange(next === "" ? null : field.type === "number" ? Number(next) : next);
				}}
			/>
		);
	}
	return (
		<div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
			<div className="mb-1 flex items-center gap-2"><label htmlFor={inputId} className="text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors duration-200">{label}{field.required ? " *" : ""}</label>{field.lang ? <LanguagePill lang={field.lang} /> : null}</div>
			{control}
			{error ? <p id={errorId} role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
		</div>
	);
}
