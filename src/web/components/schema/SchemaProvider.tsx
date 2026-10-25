import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FieldRegistry } from "../../../schema/field-registry.ts";
import { getDefaultTaskSchema } from "../../../schema/default-schema.ts";
import type { SchemaField, SchemaSection, TaskSchema } from "../../../schema/types.ts";
import { apiClient } from "../../lib/api.ts";

interface SchemaContextValue {
	schema: TaskSchema;
	registry: FieldRegistry;
	field: (key: string) => SchemaField | undefined;
	section: (id: string) => SchemaSection | undefined;
	refresh: () => Promise<void>;
}

const fallbackSchema = getDefaultTaskSchema();
const fallbackRegistry = new FieldRegistry(fallbackSchema);
const SchemaContext = createContext<SchemaContextValue>({
	schema: fallbackSchema,
	registry: fallbackRegistry,
	field: (key) => fallbackSchema.fields[key],
	section: (id) => fallbackSchema.sections[id],
	refresh: async () => {},
});

export function SchemaProvider({ children, initialSchema = fallbackSchema }: { children: ReactNode; initialSchema?: TaskSchema }) {
	const [schema, setSchema] = useState<TaskSchema>(initialSchema);
	const requestId = useRef(0);
	const refresh = useCallback(async () => {
		const id = ++requestId.current;
		const next = await apiClient.fetchSchema();
		if (id === requestId.current) setSchema(next);
	}, []);
	useEffect(() => {
		const onUpdate = () => {
			// An uninitialized project has no server schema yet. The built-in schema stays usable.
			void refresh().catch(() => {});
		};
		onUpdate();
		window.addEventListener("backlog-data-updated", onUpdate);
		return () => {
			requestId.current += 1;
			window.removeEventListener("backlog-data-updated", onUpdate);
		};
	}, [refresh]);
	const value = useMemo<SchemaContextValue>(
		() => ({
			schema,
			registry: new FieldRegistry(schema),
			field: (key) => schema.fields[key],
			section: (id) => schema.sections[id],
			refresh,
		}),
		[schema, refresh],
	);
	return <SchemaContext.Provider value={value}>{children}</SchemaContext.Provider>;
}

export function useSchema(): SchemaContextValue {
	return useContext(SchemaContext);
}
