import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useSchema } from "./SchemaProvider.tsx";

interface DisplayLanguageValue {
	lang: string | undefined;
	setLang: (lang: string) => void;
	displayLanguages: string[];
	defaultLanguage: string | undefined;
}

const DisplayLanguageContext = createContext<DisplayLanguageValue | null>(null);
const STORAGE_KEY = "backlog-display-language";

function storedLanguage(): string | undefined {
	try {
		return window.localStorage.getItem(STORAGE_KEY) ?? undefined;
	} catch {
		return undefined;
	}
}

export function DisplayLanguageProvider({ children }: { children: ReactNode }) {
	const { registry } = useSchema();
	const [searchParams, setSearchParams] = useSearchParams();
	const [stored, setStored] = useState(storedLanguage);
	const inUrl = searchParams.get("lang") ?? undefined;
	const valid = (candidate?: string) => candidate && registry.displayLanguages.includes(candidate);
	const lang = valid(inUrl) ? inUrl : valid(stored) ? stored : registry.defaultLanguage;
	const setLang = useCallback((next: string) => {
		if (!registry.displayLanguages.includes(next)) return;
		setStored(next);
		setSearchParams((current) => {
			const updated = new URLSearchParams(current);
			updated.set("lang", next);
			return updated;
		}, { replace: true });
	}, [registry, setSearchParams]);
	useEffect(() => {
		if (!lang) return;
		try { window.localStorage.setItem(STORAGE_KEY, lang); } catch { /* Storage can be unavailable. */ }
		if (registry.displayLanguages.length > 1 && inUrl !== lang) {
			setSearchParams((current) => {
				const updated = new URLSearchParams(current);
				updated.set("lang", lang);
				return updated;
			}, { replace: true });
		}
	}, [inUrl, lang, registry.displayLanguages.length, setSearchParams]);
	const value = useMemo(() => ({ lang, setLang, displayLanguages: registry.displayLanguages, defaultLanguage: registry.defaultLanguage }), [lang, setLang, registry]);
	return <DisplayLanguageContext.Provider value={value}>{children}</DisplayLanguageContext.Provider>;
}

export function useDisplayLanguage(): DisplayLanguageValue {
	const context = useContext(DisplayLanguageContext);
	const { registry } = useSchema();
	return context ?? { lang: registry.defaultLanguage, setLang: () => {}, displayLanguages: registry.displayLanguages, defaultLanguage: registry.defaultLanguage };
}

export function FallbackLanguageCode({ lang }: { lang?: string }) {
	return lang ? <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">{lang.toUpperCase()}</span> : null;
}
