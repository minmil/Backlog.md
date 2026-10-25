import MermaidMarkdown from "../MermaidMarkdown.tsx";

export default function OtherContent({ other }: { other: string | null | undefined }) {
	if (!other?.trim()) return null;
	return (
		<section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
			<h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Other</h2>
			<div className="prose prose-sm !max-w-none wmde-markdown"><MermaidMarkdown source={other} /></div>
		</section>
	);
}
