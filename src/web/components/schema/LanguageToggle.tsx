import SelectControl from "../SelectControl.tsx";
import { useDisplayLanguage } from "./DisplayLanguageContext.tsx";

export default function LanguageToggle() {
	const { lang, setLang, displayLanguages } = useDisplayLanguage();
	if (displayLanguages.length < 2) return null;
	if (displayLanguages.length >= 3) return <SelectControl aria-label="Display language" minWidthClass="min-w-[90px]" value={lang ?? ""} onChange={(event) => setLang(event.target.value)}>{displayLanguages.map((code) => <option key={code} value={code}>{code.toUpperCase()}</option>)}</SelectControl>;
	return <div role="group" aria-label="Display language" className="flex items-center rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">{displayLanguages.map((code) => <button key={code} type="button" onClick={() => setLang(code)} aria-pressed={lang === code} className={`p-2 rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:ring-offset-2 dark:focus:ring-stone-400 dark:focus:ring-offset-gray-900 text-xs font-semibold ${lang === code ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100" : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"}`}>{code.toUpperCase()}</button>)}</div>;
}
