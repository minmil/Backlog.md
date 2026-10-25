import type React from "react";
import type { FieldValue as RegistryFieldValue } from "../../../schema/field-registry.ts";
import StoredDate from "../StoredDate.tsx";
import EnumBadge from "./EnumBadge.tsx";
import { useSchema } from "./SchemaProvider.tsx";

interface Props {
	fieldKey: string;
	value: RegistryFieldValue | null | undefined;
	variant: "card" | "cell" | "detail";
	dateFormat?: string;
}

export default function FieldValue({ fieldKey, value, variant, dateFormat }: Props): React.ReactElement | null {
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
		return <StoredDate value={String(value)} compact={variant !== "detail"} dateFormat={dateFormat} />;
	}
	if (definition.type === "enum" && variant === "card") {
		return <EnumBadge fieldKey={fieldKey} value={String(value)} options={definition.values} />;
	}
	const displayUser = (handle: string) => schema.users.find((user) => user.handle === handle)?.name ?? handle;
	const display = (item: string) => definition.type === "user" || definition.type === "user-list" ? displayUser(item) : item;
	if (Array.isArray(value)) {
		if (variant === "cell") return <span>{value.map(display).join(", ")}</span>;
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
