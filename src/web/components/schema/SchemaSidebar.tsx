import type { FieldValue as RegistryFieldValue } from "../../../schema/field-registry.ts";
import type { Milestone, Task } from "../../../types/index.ts";
import FieldInput from "./FieldInput.tsx";
import FieldValue from "./FieldValue.tsx";
import { useSchema } from "./SchemaProvider.tsx";
import LanguagePill from "./LanguagePill.tsx";
import { useDisplayLanguage, FallbackLanguageCode } from "./DisplayLanguageContext.tsx";

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
	overdueFields?: string[];
}

export default function SchemaSidebar({ values, onChange, mode, readOnly, draft, errors, availableTasks, milestones, dateFormat, overdueFields }: Props) {
	const { schema, registry } = useSchema();
	const { lang, defaultLanguage } = useDisplayLanguage();
	const orderedFields = registry.translationOrder(detailFieldOrder(schema), mode === "view" ? lang : undefined);
	return <>
		{orderedFields.filter((key) => mode !== "create" || key !== "title").map((key) => {
			const field = schema.fields[key];
			if (!field) return null;
			const value = values[key];
			if (mode === "view" && (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0))) return null;
			const source = field.translation_of ?? key;
			const fallback = mode === "view" && lang && lang !== defaultLanguage && source === key && registry.translationGroup(key).length > 1 && !registry.translationGroup(key).some((member) => member !== key && schema.fields[member]?.lang === lang && values[member]);
			const editable = mode !== "view" && !readOnly && field.type !== "sequence" && !(draft && key === "status");
			const willAssign = field.type === "sequence" && mode === "create" && !draft && !values[key] &&
				Boolean(field.scope && typeof values[field.scope] === "string" && field.prefixes?.[values[field.scope] as string]) &&
				(!field.assign_when || Object.entries(field.assign_when).every(([conditionKey, allowed]) => {
					const actual = values[conditionKey];
					const candidates = Array.isArray(allowed) ? allowed : [allowed];
					return Array.isArray(actual) ? actual.some((item) => candidates.includes(item)) : candidates.includes(actual as string | boolean);
				}));
			return editable ? (
				<div key={key}>
					<FieldInput fieldKey={key} value={values[key]} onChange={(value) => onChange(key, value)} error={errors?.[key]} availableTasks={availableTasks} milestones={milestones} />
				</div>
			) : (
				<div key={key} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
					<div className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100"><span>{field.label ?? key}</span>{field.lang ? <LanguagePill lang={field.lang} /> : null}</div>
					<div className="text-sm text-gray-700 dark:text-gray-300"><FieldValue fieldKey={key} value={values[key]} variant="detail" dateFormat={dateFormat} overdue={overdueFields?.includes(key)} milestones={milestones} />{fallback ? <FallbackLanguageCode lang={field.lang} /> : null}{willAssign ? <span className="text-xs text-gray-500 dark:text-gray-400">Assigned on save</span> : null}</div>
				</div>
			);
		})}
	</>;
}
