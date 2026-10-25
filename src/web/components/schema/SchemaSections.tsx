import type { ChecklistItem, LogInput, SectionValue } from "../../../markdown/sections.ts";
import type { TaskSchema } from "../../../schema/types.ts";
import OtherContent from "./OtherContent.tsx";
import SectionBlock from "./SectionBlock.tsx";
import { useSchema } from "./SchemaProvider.tsx";

export function sectionOrder(schema: TaskSchema): string[] {
	const keys = Object.keys(schema.sections);
	return keys.flatMap((key) => schema.sections[key]?.translation_of
		? []
		: [key, ...keys.filter((candidate) => schema.sections[candidate]?.translation_of === key)]);
}

interface Props {
	values: Record<string, SectionValue>;
	other?: string;
	mode: "view" | "edit";
	onChange: (id: string, value: string | ChecklistItem[]) => void;
	onAppendLog?: (id: string, entry: LogInput) => void | Promise<void>;
}

export default function SchemaSections({ values, other, mode, onChange, onAppendLog }: Props) {
	const { schema } = useSchema();
	return <>
		{sectionOrder(schema).map((id) => {
			const section = schema.sections[id];
			return <div key={id}>
				{section?.lang ? <span className="text-xs text-gray-500 dark:text-gray-400">{section.lang}</span> : null}
				<SectionBlock sectionId={id} value={values[id]} mode={mode} onChange={(value) => onChange(id, value)} onAppendLog={(entry) => onAppendLog?.(id, entry)} />
			</div>;
		})}
		<OtherContent other={other} />
	</>;
}
