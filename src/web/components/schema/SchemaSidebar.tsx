import type { FieldValue as RegistryFieldValue } from "../../../schema/field-registry.ts";
import type { Milestone, Task } from "../../../types/index.ts";
import FieldInput from "./FieldInput.tsx";
import FieldValue from "./FieldValue.tsx";
import { useSchema } from "./SchemaProvider.tsx";

export function detailFieldOrder(schema: ReturnType<typeof useSchema>["schema"]): string[] {
	const all = Object.keys(schema.fields).filter((key) => !schema.fields[key]?.hidden);
	const requested = schema.ui.detail.order.filter((key) => all.includes(key));
	const order = [...new Set([...requested, ...all])];
	const translations = new Map<string, string[]>();
	for (const key of order) {
		const source = schema.fields[key]?.translation_of;
		if (source) translations.set(source, [...(translations.get(source) ?? []), key]);
	}
	return order.flatMap((key) => schema.fields[key]?.translation_of ? [] : [key, ...(translations.get(key) ?? [])]);
}

interface Props {
	values: Record<string, RegistryFieldValue | null>;
	onChange: (key: string, value: RegistryFieldValue | null) => void;
	mode: "view" | "edit" | "create";
	readOnly?: boolean;
	draft?: boolean;
	errors?: Record<string, string>;
	availableTasks?: Task[];
	milestones?: Milestone[];
	dateFormat?: string;
}

export default function SchemaSidebar({ values, onChange, mode, readOnly, draft, errors, availableTasks, milestones, dateFormat }: Props) {
	const { schema } = useSchema();
	return <>
		{detailFieldOrder(schema).filter((key) => mode !== "create" || key !== "title").map((key) => {
			const field = schema.fields[key];
			if (!field) return null;
			const editable = mode !== "view" && !readOnly && !(draft && key === "status");
			return editable ? (
				<div key={key}>
					{field.lang ? <span className="text-xs text-gray-500 dark:text-gray-400">{field.lang}</span> : null}
					<FieldInput fieldKey={key} value={values[key]} onChange={(value) => onChange(key, value)} error={errors?.[key]} availableTasks={availableTasks} milestones={milestones} />
				</div>
			) : (
				<div key={key} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
					<div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{field.label ?? key}{field.lang ? <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">{field.lang}</span> : null}</div>
					<div className="text-sm text-gray-700 dark:text-gray-300"><FieldValue fieldKey={key} value={values[key]} variant="detail" dateFormat={dateFormat} /></div>
				</div>
			);
		})}
	</>;
}
