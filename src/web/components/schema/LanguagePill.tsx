export default function LanguagePill({ lang }: { lang: string }) {
	return <span className="ml-auto shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">{lang}</span>;
}
