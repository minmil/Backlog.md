# Technical handoff: schema-driven tracker fork

This public fork retains Markdown task files and a YAML task schema. Examples and tests use fictional data. `backlog init` writes an editable `task-schema.yml`; projects without that file use the same built-in schema through the field registry. The registry owns field validation, reads, sorting, filtering, display values, sequence references, and translation groups. Generic Markdown, checklist, and log sections are also schema-driven.

## Current interface

- CLI: `backlog schema --json`, `task create/edit/view/list`, `draft`, `search`, `board export`, `task log`, and `i18n missing`. `--field`, `--where`, `--sort`, and `--show-fields` use schema keys. Task JSON is version 2 with `fields`, `unknownFields`, and detailed `sections`/`other` where applicable.
- Browser: Board, All Tasks, Milestones, Drafts, Statistics, task detail and edit, Settings, Docs, and Decisions. The board and list filters and columns come from the schema. Statistics filters are selected by `ui.statistics.filters`. Shared `SelectControl` handles dropdowns.
- API: task, search, schema, and statistics endpoints expose registry-backed values. Read endpoints accept `lang`; invalid language codes return HTTP 400 with allowed codes.
- Language display: schema `lang`/`translation_of` connects source fields and Markdown sections to translated members. The browser toggle appears when at least two languages exist. Its value is persisted locally and in the URL. Board, list, draft, milestone, search, Statistics, and task detail titles use the selected language; fallback source values are marked. View puts selected language first; edit keeps every member. CLI reads accept `--lang` or `BACKLOG_LANG`, and JSON adds a `display` projection only when a language is selected. `i18n missing` reports untranslated values.
- Example schema: `docs/examples/operations-tracker-schema.yml` has fictional clients, users, sequence references, overdue rules, sections, and statistics filters. `docs/examples/AGENTS.md.template` shows CLI guidance for a task-tracking repository.

## Verification and current limits

The Part 1 gate completed at 3,396 pass, 46 skip, and 22 known failures across 319 files; `check`, `check:types`, and `build` pass. The known baseline is 19 archive/record cases and three Nix cases requiring Node 26.12.1 on a Node 24 host. TUI and MCP feature upgrades remain outside the owner-approved scope; their related tests stay skipped. The browser language display is focused on task-facing surfaces; app chrome, field labels, section titles, and enum values remain in their configured language. Screenshots used for review live outside this repository under `/tmp/lang-screenshots/`.

See `PROGRESS.md` for commit-by-commit work and gate counts, `KNOWN-FAILURES.md` for the baseline, and `UPSTREAM-SYNC.md` for the last reviewed upstream changes.
