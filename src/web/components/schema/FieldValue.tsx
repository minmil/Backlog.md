import type React from "react";
import type { FieldValue as RegistryFieldValue } from "../../../schema/field-registry.ts";
import { getMilestoneLabel } from "../../../core/milestones.ts";
import type { Milestone } from "../../../types/index.ts";
import StoredDate from "../StoredDate.tsx";
import EnumBadge from "./EnumBadge.tsx";
import { useSchema } from "./SchemaProvider.tsx";

interface Props {
	fieldKey: string;
	value: RegistryFieldValue | null | undefined;
	variant: "card" | "cell" | "detail";
	dateFormat?: string;
	overdue?: boolean;
	milestones?: Milestone[];
}

export default function FieldValue({ fieldKey, value, variant, dateFormat, overdue = false, milestones }: Props): React.ReactElement | null {
	const { schema } = useSchema();
	const definition = schema.fields[fieldKey];
	if (!definition || value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) {
		return variant === "cell" ? <span className="text-gray-400 dark:text-gray-500">–</span> : null;
	}
	if (definition.type === "bool") {
		if (variant === "card") return value ? <EnumBadge fieldKey={fieldKey} value={definition.label ?? fieldKey} /> : null;
		return <span aria-label={value ? "Yes" : "No"}>{value ? "✓" : "–"}</span>;
	}
	if (definition.type === "date" || definition.type === "datetime") {
		return <span className={overdue ? "text-red-600 dark:text-red-400" : undefined}><StoredDate value={String(value)} compact={variant !== "detail" && fieldKey !== "due_date"} dateFormat={dateFormat} />{overdue ? <span className="ml-1 text-xs">overdue</span> : null}</span>;
	}
	if (definition.type === "milestone-ref" && milestones) {
		return <span>{getMilestoneLabel(String(value), milestones)}</span>;
	}
	if (definition.type === "enum" && variant === "card") {
		return <EnumBadge fieldKey={fieldKey} value={String(value)} options={definition.values} />;
	}
	if (definition.type === "sequence" && variant === "card") {
		return <EnumBadge fieldKey={fieldKey} value={String(value)} neutral />;
	}
	const displayUser = (handle: string) => schema.users.find((user) => user.handle === handle)?.name ?? handle;
	const display = (item: string) => definition.type === "user" || definition.type === "user-list" ? displayUser(item) : item;
	if (Array.isArray(value)) {
		if (variant === "cell") return <span>{value.map(display).join(", ")}</span>;
		if (variant === "card" && definition.type === "user-list") return <span className="truncate max-w-[80px]" title={value.map(display).join(", ")}>{display(value[0] ?? "")}</span>;
		if (variant === "card") return <span className="flex flex-wrap gap-1">{value.slice(0, 3).map((item) => <span key={item} className="inline-block px-1.5 py-0.5 text-[10px] bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded transition-colors duration-200">{display(item)}</span>)}{value.length > 3 ? <span className="inline-block px-1.5 py-0.5 text-[10px] text-gray-400 dark:text-gray-500">+{value.length - 3}</span> : null}</span>;
		return (
			<span className="flex flex-wrap gap-2">
				{value.map((item) => (
					<span key={item} className="inline-flex items-center px-2 py-0.5 text-sm bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 rounded-md">
						{display(item)}
					</span>
				))}
			</span>
		);
	}
	return <span>{display(String(value))}</span>;
}
