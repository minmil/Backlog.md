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
	onToggleChecklist?: (id: string, index: number, checked: boolean) => void | Promise<void>;
	checklistBusy?: boolean;
	readOnly?: boolean;
	onAppendLog?: (id: string, entry: LogInput) => void | Promise<void>;
	onLogDraftChange?: (id: string, hasDraft: boolean) => void;
}

export default function SchemaSections({ values, other, mode, onChange, onToggleChecklist, checklistBusy, readOnly, onAppendLog, onLogDraftChange }: Props) {
	const { schema } = useSchema();
	return <>
		{sectionOrder(schema).map((id) => {
			return <div key={id}>
				<SectionBlock sectionId={id} value={values[id]} mode={mode} onChange={(value) => onChange(id, value)} onToggleChecklist={(index, checked) => onToggleChecklist?.(id, index, checked)} checklistBusy={checklistBusy} readOnly={readOnly} onAppendLog={(entry) => onAppendLog?.(id, entry)} onLogDraftChange={(hasDraft) => onLogDraftChange?.(id, hasDraft)} />
			</div>;
		})}
		<OtherContent other={other} />
	</>;
}
