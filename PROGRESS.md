# Schema-driven tracker progress

## Task 1 — UI and code audit

Mapped the current task field and body-section usage across the web UI, server, CLI, TUI and MCP in `AUDIT.md`. Captured the current browser layout from a ten-task sample in light and dark mode, including scrolled task-detail views, under `docs/screenshots/before/`. The capture script is retained for reproducibility. No application behavior changed.

Owner decisions: use every actually persisted serializer key as core, including `subtasks` and `onStatusChange`; keep computed `branch` read-only through the canonical field access layer; retain the `Ordinal` list column and show it read-only in detail; allow an empty value list for optional core `project`, with schema boilerplate showing how to fill it. No TUI or MCP behavior changed in Task 1.

Verification: `bun run check`, `bun run check:types`, and `bun run build` passed. `bun test --timeout=10000` matched the prior custom-fields baseline: 3,609 passed, 13 skipped, 19 known failures across 3,641 tests. The first run with Bun's default five-second timeout added two timeouts in tests that deliberately sleep six seconds; the recorded baseline also uses `--timeout=10000`. No tests were deleted.

## Task 2 — Schema loader and validator (in progress)

Added the default and example `task-schema.yml` definitions, a nested-YAML loader with strict structural checks, task-field validation, and `backlog schema [--json]` / `backlog schema validate`. Fresh `backlog init` writes the default schema, and schema-backed config serialization omits keys now owned by the schema. Loading a schema-backed project rejects leftover moved config keys and `fields.yml`. A transitional config bridge supplies existing internal callers from schema values while the field registry is being built.

The new schema tests cover the specified invalid cases, broken stored task references, and reference cycles. A fresh filesystem-only project was initialized in `/tmp/schema-init-smoke-20261024`; its config has no moved keys, its schema command works from source and the built binary, and task creation plus schema validation succeed. The advanced wizard no longer prompts for Definition of Done defaults. Existing CLI field/help/config commands and the browser Settings screen still expose old concepts; they and the remaining startup enforcement need to be replaced before Task 2 is complete. No browser field rendering has changed yet.

## Task 3 — Field registry and CLI fields (in progress)

Added a canonical `FieldRegistry` for core and declared custom fields. It reads, validates, normalizes, sets, clears, filters, sorts and formats values using the schema. Task parsing and serialization now carry custom schema values in `fieldValues` and preserve undeclared frontmatter. The main filesystem task paths pass the schema through those operations. Core task creation applies custom defaults and validates supplied values before writing. `task create --field` accepts core and custom keys through the registry, including `title`; the older custom-field path remains temporarily for projects without a schema.

Focused registry tests cover all field types, core and custom mutations, conditions, sorting, round-tripping through parser and filesystem, and invalid create without a write. A CLI smoke project in `/tmp/schema-registry-cli-20261024` created a task using only `--field` assignments; its enum spelling, boolean, list and date values serialized correctly, while an invalid enum was rejected before writing. Schema validation now accepts the internal `Draft` status only for files in draft directories. `task edit`, list/view/JSON output, and the remaining CLI aliases have not yet moved to the registry. The TUI, MCP and web UI have not yet changed.
