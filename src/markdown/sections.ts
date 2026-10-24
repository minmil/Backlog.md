import type { TaskSchema } from "../schema/types.ts";

export interface ChecklistItem {
	index: number;
	text: string;
	checked: boolean;
}

export interface LogEntry {
	author: string;
	date: string;
	createdAt: string;
	auto?: boolean;
	body: string;
}

export type SectionValue = string | ChecklistItem[] | LogEntry[];

interface SectionRange {
	id: string;
	start: number;
	end: number;
}

export interface ParsedSections {
	sections: Record<string, SectionValue>;
	other: string;
	/** The source body is retained so untouched content keeps its exact bytes and position. */
	source: string;
}

function marker(id: string, kind: "BEGIN" | "END"): string {
	return `<!-- SECTION:${id.toUpperCase()}:${kind} -->`;
}

function fencedRanges(body: string): Array<{ start: number; end: number }> {
	const ranges: Array<{ start: number; end: number }> = [];
	let offset = 0;
	let open: { start: number; character: string; length: number } | undefined;
	for (const lineWithEnding of body.match(/[^\n]*(?:\n|$)/g) ?? []) {
		if (!lineWithEnding) break;
		const line = lineWithEnding.replace(/\r?\n$/, "");
		const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
		if (!open && fence) {
			const run = fence[1] ?? "";
			if (run[0] !== "`" || !(fence[2] ?? "").includes("`")) {
				open = { start: offset, character: run[0] ?? "`", length: run.length };
			}
		} else if (open && fence) {
			const run = fence[1] ?? "";
			if (run[0] === open.character && run.length >= open.length && !(fence[2] ?? "").trim()) {
				ranges.push({ start: open.start, end: offset + lineWithEnding.length });
				open = undefined;
			}
		}
		offset += lineWithEnding.length;
	}
	if (open) ranges.push({ start: open.start, end: body.length });
	return ranges;
}

function sectionRanges(body: string, schema: TaskSchema): SectionRange[] {
	const ranges: SectionRange[] = [];
	const fences = fencedRanges(body);
	const inFence = (position: number) => fences.some((range) => position >= range.start && position < range.end);
	const opener = /^<!-- SECTION:([A-Z][A-Z0-9_]*):BEGIN -->\r?$/gm;
	let match = opener.exec(body);
	while (match) {
		if (inFence(match.index)) {
			match = opener.exec(body);
			continue;
		}
		const id = match[1]?.toLowerCase() ?? "";
		if (!schema.sections[id]) {
			match = opener.exec(body);
			continue;
		}
		const startMarker = match.index;
		const endMarker = marker(id, "END");
		let close = body.indexOf(endMarker, opener.lastIndex);
		while (
			close >= 0 &&
			(inFence(close) ||
				(close > 0 && body[close - 1] !== "\n") ||
				!/^\r?(?:\n|$)/.test(body.slice(close + endMarker.length)))
		) {
			close = body.indexOf(endMarker, close + endMarker.length);
		}
		if (close < 0) {
			match = opener.exec(body);
			continue;
		}
		let start = startMarker;
		const prefix = body.slice(0, startMarker);
		const heading = /(^|\n)(## [^\r\n]+)\r?\n\r?\n$/.exec(prefix);
		if (heading) start = prefix.length - heading[0].length + (heading[1]?.length ?? 0);
		const end = close + endMarker.length;
		if (ranges.some((range) => start < range.end)) {
			match = opener.exec(body);
			continue;
		}
		ranges.push({ id, start, end });
		opener.lastIndex = end;
		match = opener.exec(body);
	}
	return ranges;
}

function rawSectionBody(block: string, id: string): string {
	const open = marker(id, "BEGIN");
	const close = marker(id, "END");
	const start = block.indexOf(open) + open.length;
	const end = block.lastIndexOf(close);
	let value = block.slice(start, end);
	if (value.startsWith("\r\n")) value = value.slice(2);
	else if (value.startsWith("\n")) value = value.slice(1);
	if (value.endsWith("\r\n")) value = value.slice(0, -2);
	else if (value.endsWith("\n")) value = value.slice(0, -1);
	return value;
}

function parseChecklist(value: string): ChecklistItem[] {
	return value
		.split(/\r?\n/)
		.flatMap((line) => {
			const match = /^- \[([ xX])\] #\d+ (.*)$/.exec(line);
			return match ? [{ index: 0, text: match[2] ?? "", checked: match[1] !== " " }] : [];
		})
		.map((item, index) => ({ ...item, index: index + 1 }));
}

function parseLog(value: string): LogEntry[] {
	const lines = value.split(/\r?\n/);
	const entries: LogEntry[] = [];
	let index = 0;
	while (index < lines.length) {
		while (lines[index]?.trim() === "") index++;
		if (index >= lines.length) break;
		const headers: Record<string, string> = {};
		while (index < lines.length && lines[index] !== "---") {
			const line = lines[index++] ?? "";
			const separator = line.indexOf(":");
			if (separator > 0) headers[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
		}
		if (lines[index] !== "---") break;
		index++;
		const body: string[] = [];
		while (index < lines.length && lines[index] !== "---") body.push(lines[index++] ?? "");
		if (lines[index] !== "---") break;
		index++;
		if (headers.author && headers.date && headers.created) {
			entries.push({
				author: headers.author,
				date: headers.date,
				createdAt: headers.created,
				...(headers.auto === "true" && { auto: true }),
				body: body.join("\n").replace(/^\n|\n$/g, ""),
			});
		}
	}
	return entries;
}

function emptyValue(kind: string): SectionValue {
	return kind === "markdown" ? "" : [];
}

export function parseSections(body: string, schema: TaskSchema): ParsedSections {
	const sections: Record<string, SectionValue> = {};
	for (const [id, definition] of Object.entries(schema.sections)) sections[id] = emptyValue(definition.kind);
	let other = "";
	let cursor = 0;
	for (const range of sectionRanges(body, schema)) {
		other += body.slice(cursor, range.start);
		const value = rawSectionBody(body.slice(range.start, range.end), range.id);
		const kind = schema.sections[range.id]?.kind;
		sections[range.id] = kind === "checklist" ? parseChecklist(value) : kind === "log" ? parseLog(value) : value;
		cursor = range.end;
	}
	other += body.slice(cursor);
	return { sections, other, source: body };
}

function definitionFor(parsed: ParsedSections, id: string, schema: TaskSchema, kind: string): void {
	const definition = schema.sections[id];
	if (!definition) throw new Error(`Unknown section '${id}'. Add it to task-schema.yml first.`);
	if (definition.kind !== kind) throw new Error(`Section '${id}' must be ${kind}, not ${definition.kind}.`);
	if (!(id in parsed.sections)) parsed.sections[id] = emptyValue(definition.kind);
}

function assertNoStandaloneMarker(text: string): void {
	if (/^<!-- SECTION:[A-Z][A-Z0-9_]*:(?:BEGIN|END) -->\r?$/m.test(text)) {
		throw new Error("Section content cannot contain a standalone section marker line.");
	}
}

export function setMarkdown(parsed: ParsedSections, id: string, text: string, schema: TaskSchema): void {
	definitionFor(parsed, id, schema, "markdown");
	assertNoStandaloneMarker(text);
	parsed.sections[id] = text;
}

export function appendMarkdown(parsed: ParsedSections, id: string, text: string, schema: TaskSchema): void {
	definitionFor(parsed, id, schema, "markdown");
	assertNoStandaloneMarker(text);
	const current = parsed.sections[id] as string;
	parsed.sections[id] = current ? `${current}\n\n${text}` : text;
}

function checklist(parsed: ParsedSections, id: string, schema: TaskSchema): ChecklistItem[] {
	definitionFor(parsed, id, schema, "checklist");
	return parsed.sections[id] as ChecklistItem[];
}

export function checklistAdd(parsed: ParsedSections, id: string, text: string, schema: TaskSchema): void {
	const items = checklist(parsed, id, schema);
	if (!text.trim() || /\r|\n/.test(text)) throw new Error("Checklist item text must be one nonempty line.");
	items.push({ index: items.length + 1, text, checked: false });
}

function checklistItem(parsed: ParsedSections, id: string, n: number, schema: TaskSchema): ChecklistItem {
	const item = checklist(parsed, id, schema)[n - 1];
	if (!Number.isInteger(n) || n < 1 || !item) throw new Error(`Section '${id}' has no item #${n}.`);
	return item;
}

export function checklistCheck(parsed: ParsedSections, id: string, n: number, schema: TaskSchema): void {
	checklistItem(parsed, id, n, schema).checked = true;
}

export function checklistUncheck(parsed: ParsedSections, id: string, n: number, schema: TaskSchema): void {
	checklistItem(parsed, id, n, schema).checked = false;
}

export function checklistRemove(parsed: ParsedSections, id: string, n: number, schema: TaskSchema): void {
	checklistItem(parsed, id, n, schema);
	const items = checklist(parsed, id, schema);
	items.splice(n - 1, 1);
	items.forEach((item, index) => {
		item.index = index + 1;
	});
}

export interface LogInput {
	author?: string;
	date?: string;
	body: string;
	auto?: boolean;
}

export function logAppend(
	parsed: ParsedSections,
	id: string,
	input: LogInput,
	schema: TaskSchema,
	now = new Date(),
): void {
	definitionFor(parsed, id, schema, "log");
	const author = input.author ?? schema.users.find((user) => user.default)?.handle;
	if (!author || !schema.users.some((user) => user.handle === author)) {
		throw new Error(`Unknown log author '${author ?? ""}'. Add the handle to task-schema.yml users.`);
	}
	assertNoStandaloneMarker(input.body);
	if (/^---\r?$/m.test(input.body)) throw new Error("Log body cannot contain a standalone '---' line.");
	const date =
		input.date ??
		`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
		throw new Error(`Invalid log date '${date}'; use YYYY-MM-DD.`);
	}
	if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
		throw new Error(`Invalid log date '${date}'; use a real calendar date.`);
	}
	(parsed.sections[id] as LogEntry[]).push({
		author,
		date,
		createdAt: now.toISOString(),
		...(input.auto && { auto: true }),
		body: input.body,
	});
}

function sectionText(value: SectionValue, kind: string): string {
	if (kind === "markdown") return value as string;
	if (kind === "checklist") {
		return (value as ChecklistItem[])
			.map((item, index) => `- [${item.checked ? "x" : " "}] #${index + 1} ${item.text}`)
			.join("\n");
	}
	return (value as LogEntry[])
		.map((entry) =>
			[
				`author: ${entry.author}`,
				`date: ${entry.date}`,
				`created: ${entry.createdAt}`,
				...(entry.auto ? ["auto: true"] : []),
				"---",
				entry.body,
				"---",
			].join("\n"),
		)
		.join("\n\n");
}

function sectionBlock(id: string, value: SectionValue, schema: TaskSchema): string {
	const definition = schema.sections[id];
	if (!definition) return "";
	const text = sectionText(value, definition.kind);
	if (!text) return "";
	return `## ${definition.title}\n\n${marker(id, "BEGIN")}\n${text}\n${marker(id, "END")}`;
}

/** Writes configured blocks in schema order while retaining every outside-content gap byte-for-byte. */
export function serializeSections(parsed: ParsedSections, schema: TaskSchema): string {
	const ranges = sectionRanges(parsed.source, schema);
	const orderedIds = Object.keys(schema.sections).filter((id) =>
		sectionBlock(id, parsed.sections[id] ?? emptyValue(schema.sections[id]?.kind ?? "markdown"), schema),
	);
	let output = "";
	let cursor = 0;
	for (const [index, range] of ranges.entries()) {
		output += parsed.source.slice(cursor, range.start);
		const id = orderedIds[index];
		if (id) {
			const value = parsed.sections[id] ?? emptyValue(schema.sections[id]?.kind ?? "markdown");
			const original =
				id === range.id ? parseSections(parsed.source.slice(range.start, range.end), schema).sections[id] : undefined;
			output +=
				id === range.id && JSON.stringify(original) === JSON.stringify(value)
					? parsed.source.slice(range.start, range.end)
					: sectionBlock(id, value, schema);
		}
		cursor = range.end;
	}
	output += parsed.source.slice(cursor);
	for (const id of orderedIds.slice(ranges.length)) {
		const block = sectionBlock(id, parsed.sections[id] ?? emptyValue(schema.sections[id]?.kind ?? "markdown"), schema);
		if (block) output += `${output && !output.endsWith("\n\n") ? "\n\n" : ""}${block}`;
	}
	return output;
}
