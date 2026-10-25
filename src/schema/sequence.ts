import type { SchemaField } from "./types.ts";

/** Parse only the canonical stored spelling of a configured sequence reference. */
export function parseSequenceReference(value: unknown, field: SchemaField): { prefix: string; number: bigint } | null {
	if (typeof value !== "string" || !field.prefixes || !field.pad) return null;
	const match = /^([A-Z][A-Z0-9]{1,9})-(\d+)$/.exec(value);
	if (!match) return null;
	const [, prefix = "", digits = ""] = match;
	if (!Object.values(field.prefixes).includes(prefix)) return null;
	const number = BigInt(digits);
	if (number < 1n || digits !== number.toString().padStart(field.pad, "0")) return null;
	return { prefix, number };
}

export function nextSequenceReference(prefix: string, number: bigint, pad: number): string {
	return `${prefix}-${(number + 1n).toString().padStart(pad, "0")}`;
}
