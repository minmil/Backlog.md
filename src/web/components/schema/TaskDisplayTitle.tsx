import type { Task } from "../../../types/index.ts";
import { useDisplayLanguage, FallbackLanguageCode } from "./DisplayLanguageContext.tsx";
import { useSchema } from "./SchemaProvider.tsx";

export function useTaskDisplay() {
	const { registry } = useSchema();
	const { lang, defaultLanguage } = useDisplayLanguage();
	const resolve = (task: Task, key: string) =>
		lang ? registry.resolveDisplay(task, key, lang) : { value: registry.getField(task, key), lang: undefined, fallback: false };
	const title = (task: Task) => resolve(task, "title");
	const showFallback = (fallback: boolean) => fallback && lang !== defaultLanguage;
	return { resolve, title, showFallback, lang };
}

export default function TaskDisplayTitle({ task }: { task: Task }) {
	const { title, showFallback } = useTaskDisplay();
	const resolved = title(task);
	return <>{String(resolved.value ?? "")}{showFallback(resolved.fallback) && <FallbackLanguageCode lang={resolved.lang} />}</>;
}
