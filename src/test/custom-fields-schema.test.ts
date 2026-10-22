import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getReservedFieldNames, loadCustomFieldSchema, normalizeCustomFieldValue } from "../utils/custom-fields.ts";

let directory: string;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "backlog-fields-"));
});

afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

function schema(source: string) {
	writeFileSync(join(directory, "fields.yml"), source);
	return loadCustomFieldSchema(directory);
}

describe("custom field schema", () => {
	it("uses an empty schema when fields.yml is absent", () => {
		expect(loadCustomFieldSchema(directory)).toEqual({ fields: {} });
	});

	it("parses and normalizes all supported definitions", () => {
		expect(
			schema(`fields:
  flag:
    type: bool
    default: yes
  day:
    type: date
    default: '2026-10-22'
  stage:
    type: enum
    values: [Pending Triage, Testing]
    default: testing
    track_changes: true
    description: Technical state
  note:
    type: text
`),
		).toEqual({
			fields: {
				flag: { type: "bool", default: true, trackChanges: false },
				day: { type: "date", default: "2026-10-22", trackChanges: false },
				stage: {
					type: "enum",
					values: ["Pending Triage", "Testing"],
					default: "Testing",
					trackChanges: true,
					description: "Technical state",
				},
				note: { type: "text", trackChanges: false },
			},
		});
	});

	it.each([
		["invalid field name", "BadName:\n    type: text", "name must match"],
		["built-in name", "status:\n    type: text", "reserved"],
		["missing type", "thing: {}", "type must be"],
		["invalid type", "thing:\n    type: number", "type must be"],
		["missing enum values", "thing:\n    type: enum", "requires a non-empty"],
		["non-enum values", "thing:\n    type: text\n    values: [x]", "only for enum"],
		["duplicate enum values", "thing:\n    type: enum\n    values: [Testing, testing]", "unique ignoring case"],
		["invalid default", "thing:\n    type: date\n    default: yesterday", "invalid default"],
		["invalid description", "thing:\n    type: text\n    description: 3", "description must be"],
		["invalid track_changes", "thing:\n    type: text\n    track_changes: yes", "track_changes must be"],
	])("rejects %s", (_case, definition, error) => {
		expect(() => schema(`fields:\n  ${definition}`)).toThrow(error);
	});

	it("reserves every key owned by task serialization", () => {
		expect(getReservedFieldNames()).toContain("id");
		expect(getReservedFieldNames()).toContain("due_date");
		expect(getReservedFieldNames()).toContain("project");
	});

	it("normalizes booleans and canonical enum spelling", () => {
		const bool = { type: "bool" as const, trackChanges: false };
		for (const input of ["true", "YES", "y", "1", true]) {
			expect(normalizeCustomFieldValue(bool, input)).toEqual({ ok: true, value: true });
		}
		for (const input of ["false", "NO", "n", "0", false]) {
			expect(normalizeCustomFieldValue(bool, input)).toEqual({ ok: true, value: false });
		}
		expect(normalizeCustomFieldValue(bool, "maybe")).toEqual({
			ok: false,
			error: "expected true/false, yes/no, y/n, or 1/0",
		});
		expect(
			normalizeCustomFieldValue(
				{ type: "enum", values: ["Pending Triage", "Testing"], trackChanges: false },
				"testing",
			),
		).toEqual({ ok: true, value: "Testing" });
	});
});
