# Plan: Schema-driven fields, sections and UI for the Backlog.md fork

**Executor:** Codex, working in `backlog-fork/` on a new branch `feat/task-schema`, starting from tag `v1.55.1-cf.1` (commit `c645ca5`).
**Owner:** Alice. This plan is the approved design. Where it is silent, choose the simplest option consistent with it and note the choice in the task's completion notes. Stop and ask only where marked **[ASK]**.
**Read first:** `TECHNICAL-HANDOFF.md`, `ACCEPTANCE.md`, `CLI-INSTRUCTIONS.md`, `AGENTS.md`, `DEVELOPMENT.md` and `NOTES-baseline.md` in the fork.

---

## 1. Goal

Replace every hard-coded task field and body section with **one schema file**, `backlog/task-schema.yml`. It defines:
- **fields**: all frontmatter fields, including the original built-in ones
- **sections**: all Markdown body sections
- **users**: who can be assigned and who can write log entries
- **ui**: which fields appear in which area of the web UI

The CLI, the JSON output, the server API and the web UI all read the schema and treat every field the same way. Built-in fields get no special-case operations. The only difference is that **core** fields must stay in the schema.

This is **stage 1: build behavior**. Stage 2, the actual Operations Tracker configuration (categories, clients, enum values), is out of scope. Ship a default schema that reproduces today's behavior, plus one example schema for the tracker use case.

### Non-goals for this round
- No new screens. Every existing screen keeps working with its current layout and look.
- The TUI (`src/ui/`) and the MCP tools (`src/mcp/`) are not upgraded. Make only the changes needed for the project to **type-check and build**. If they lose features at runtime, that's acceptable. List what broke in the completion notes.
- The Docs, Decisions and Statistics screens are not redesigned. They must still **render** without errors.
- No upstream compatibility is required. The owner will not pull from upstream, so delete obsolete code instead of leaving it dormant.
- There is no data to migrate. Codex's `fields.yml` is replaced, not converted.

---

## 2. The schema file

`backlog/task-schema.yml` (root-config layouts: `<backlog_dir>/task-schema.yml`). Parse it with a real YAML parser; the line-based config parser in `src/file-system/operations.ts` does not handle nested YAML. `backlog init` writes the default schema (§2.6). A missing or invalid schema is a startup error with a clear message: Backlog.md will not run without one.

### 2.1 `users`

```yaml
users:
  - handle: "@alice"
    name: Alice
    default: true        # exactly one default; used as reporter and log author when none is given
  - handle: "@tanaka"
    name: Tanaka
```

- Handles match `^@[A-Za-z0-9._-]+$`.
- Fields of type `user` and `user-list`, and log authors, must reference a listed handle. A write with an unknown handle fails and lists the valid ones.
- An empty `users` list means any handle is accepted, as today. Exactly one user is marked `default` whenever the list is non-empty.

### 2.2 `fields`

Each key is the **frontmatter key**. Fields appear in the schema in display order.

```yaml
fields:
  title:    {type: text, core: true, required: true, lang: en}
  title_ja: {type: text, label: Title (JA), lang: ja, translation_of: title}
  status:   {type: enum, core: true, values: [To Do, In Progress, Done], default: To Do}
  priority: {type: enum, core: true, values: [High, Medium, Low]}
  release_item: {type: bool, default: false, label: Release item}
  uat_date: {type: date, label: UAT date}
  teams:    {type: multi-enum, values: [Data, Reporting, Infra]}
```

**Field attributes**

| Attribute | Meaning |
|---|---|
| `type` | One of the types in §2.3. Required. For core fields it is fixed and must match the default schema. |
| `label` | Display name. Defaults to the key, title-cased. |
| `description` | Help text shown in the CLI `schema` output and as a tooltip in the UI. |
| `core` | `true` for fields the app depends on. Core fields cannot be removed and their type cannot change. A schema missing a core field fails validation with a clear error. |
| `managed` | The tool sets the value, and it is never user-editable (id, created/updated dates, ordinal, and similar). Managed fields are implicitly core. |
| `hidden` | Kept in storage and JSON, but not shown in the UI. Use it for internal core fields the owner doesn't need, such as `branch`, `ordinal` and `modified_files`. |
| `required` | Enforced on create, and on promoting a draft. `validate` reports violations. |
| `default` | Applied on create only. It must be valid for the field's type. |
| `values` | Ordered allowed values for `enum` and `multi-enum`; required and non-empty for those types. The order drives sorting. For `status`, the order defines the board columns. |
| `lang` | Optional language tag (`en`, `ja`, `fr`, `es` and so on, BCP-47 style). |
| `translation_of` | Key of another field of the same type that this field translates. Used for grouping in the editor and for the language toggle (§5.8). No staleness tracking this round. |
| `track_changes` | When the value changes through the CLI or API, append an automatic log entry (§3.4). |

**Core fields:** every built-in frontmatter field that exists in v1.55.1 is core. Derive the list from `src/markdown/serializer.ts`; do not hard-code it from this plan. Expected: `id`, `title`, `status`, `assignee`, `reporter`, `created_date`, `updated_date`, `due_date`, `labels`, `milestone`, `dependencies`, `references`, `documentation`, `modified_files`, `parent_task_id`, `priority`, `type`, `project`, `ordinal`, `branch` and `on_status_change`.
- What can change: `label`, `values`, `required`, `default`, `hidden`, `description`, `lang` and `track_changes`.
- What cannot change: the key and the type.

**Non-core field names** match `^[a-z][a-z0-9_]{0,39}$`.

### 2.3 Field types

| Type | Stored as | Used by |
|---|---|---|
| `id` | string | `id` (managed) |
| `text` | string | `title`, any free text |
| `bool` | YAML bool | Inputs accept true/false/yes/no/y/n/1/0 |
| `date` | `'YYYY-MM-DD'` (no time zone) | `due_date`, custom dates |
| `datetime` | UTC `'YYYY-MM-DD HH:mm'` | `created_date`, `updated_date` (managed) |
| `enum` | string; canonical spelling, case-insensitive input | `status`, `priority`, `type`, `project`, custom |
| `multi-enum` | YAML list | custom |
| `string-list` | YAML list | `labels`, `references`, `documentation`, `modified_files` |
| `user` | string handle | `reporter` |
| `user-list` | YAML list of handles | `assignee` |
| `task-ref` | task ID | `parent_task_id`; the referenced task must exist, with no cycles |
| `task-ref-list` | list of task IDs | `dependencies`; same checks |
| `milestone-ref` | milestone ID | `milestone`; the milestone must exist |
| `number` | number | `ordinal` (managed, hidden) |

Keep the existing storage format of every built-in field exactly as it is today. This plan changes how fields are **declared and accessed**, not how they are written to disk.

Validation is **strict on write**: an invalid value fails, nothing is written, and the error lists the allowed values or the expected format. It is **lenient on read**: an invalid stored value is kept, a warning goes to stderr, and the task still loads. Frontmatter keys not declared in the schema are preserved on rewrite, as they are now, and exposed read-only in JSON as `unknownFields`.

### 2.4 `sections`

Sections appear in display order. Each key is the section ID.

```yaml
sections:
  description:    {kind: markdown, title: Description, lang: en}
  description_ja: {kind: markdown, title: Description (JA), lang: ja, translation_of: description}
  acceptance:     {kind: checklist, title: Acceptance Criteria}
  log:            {kind: log, title: Log}
```

| Attribute | Meaning |
|---|---|
| `kind` | `markdown` (free text), `checklist` (checkable items) or `log` (append-only dated entries). |
| `title` | The `##` heading written to the file and shown in the UI. |
| `description` | Help text. |
| `lang`, `translation_of` | Same meaning as for fields; `translation_of` must reference a section of the same kind. |
| `required` | Same meaning as for fields; for a `markdown` section, required means non-empty. |

Section IDs match `^[a-z][a-z0-9_]{0,39}$`. The marker ID is the uppercased section ID.

**Every hard-coded body section is removed:** Description, Acceptance Criteria, Definition of Done, Implementation Plan, Implementation Notes, Final Summary and Comments, together with their dedicated parsers, CLI flags, API fields, UI editors and tests. Their behavior survives only through the three generic kinds. Definition-of-Done defaults in `config.yml` (`definition_of_done`) are removed as well.

### 2.5 `ui`

Ordered lists of field keys for each UI area. Every listed key must exist in `fields`, must not be `hidden`, and must have a type that can be shown in that area; otherwise the schema fails validation.

```yaml
ui:
  board:
    card: [type, project, priority, labels, assignee, due_date]
    filters: [assignee, labels, priority, type, project]
  task_list:
    columns: [title, status, priority, labels, assignee, milestone, due_date, created_date]
    filters: [status, priority, milestone, labels]
  milestones:
    row: [status, priority]
  detail:
    order: []   # empty = schema order. The detail view always shows ALL non-hidden fields and ALL sections.
```

- `id` and `title` are always shown on cards and rows, and are never listed.
- Filters are only allowed for types `enum`, `multi-enum`, `bool`, `date`, `user`, `user-list`, `string-list` and `milestone-ref`. Date filters are a from/to range.
- **The defaults must reproduce the current UI exactly.** Before writing them, the audit (Task 1) records what each area shows today.

### 2.6 Shipped schemas
- `src/schema/default-task-schema.yml`, written by `backlog init`. It contains every core field, with the values and visibility that reproduce today's default behavior. Its sections are `description` (markdown), `acceptance` (checklist, titled "Acceptance Criteria") and `log` (log, titled "Log"). Its users list is empty.
- `docs/examples/operations-tracker-schema.yml`, a fictional operations example. It includes:
  - `title_ja`
  - `description_ja`
  - the custom fields from the handoff: `client_facing`, `side`, `tech_action` (`track_changes: true`), `release_item`, `raised_date`, `uat_date`, `prod_date`
  - `project` labeled "Client" and `type` labeled "Category"
  - a `ui` block showing the custom fields on cards and as columns

  Its values are placeholders, since stage 2 sets the real ones.

### 2.7 Remove duplicate sources
- In `config.yml`, `statuses`, `default_status`, `labels`, `types`, `priorities`, `projects`, `default_assignee`, `default_reporter` and `definition_of_done` move into the schema: the `values` and `default` of the corresponding fields, and the users block.
- If any of these keys is still present in `config.yml`, fail at startup with a message naming the key and its new home.
- Remove the parsing, serializing, wizard prompts and Settings controls for those keys.
- `fields.yml` is no longer read. If it exists, fail with a message pointing to `task-schema.yml`.

---

## 3. Body format and section engine

### 3.1 One marker format for every section

```markdown
## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Free Markdown…
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] #1 Client confirms new layout
- [x] #2 UAT signed off
<!-- SECTION:ACCEPTANCE:END -->

## Log

<!-- SECTION:LOG:BEGIN -->
author: @alice
date: 2026-10-23
created: 2026-10-24 05:12
---
Call with client: they confirmed the feed carries currency.
---
author: @alice
date: 2026-10-24
created: 2026-10-24 06:40
auto: true
---
tech_action: Investigating → Testing
---
<!-- SECTION:LOG:END -->
```

- Sections are written in schema order. Empty sections are omitted from the file, but still show in the UI as empty and editable.
- **Checklist items** use the existing item syntax (`- [ ] #n text`). Reuse the existing acceptance-criteria parsing and serialization logic, generalized to any checklist section.
- **Log entries** reuse the existing comment entry format and parser, generalized:
  - The header lines are `author` (a user handle), `date` (the entry's business date, `YYYY-MM-DD`; defaults to today in the machine's local day), `created` (the UTC timestamp when the entry was recorded, always set by the tool) and an optional `auto: true`.
  - The existing rule that a body cannot contain a standalone `---` line stays, and it's validated on write.
- **The "Other" catch-all:** any body content outside configured section markers is preserved byte-for-byte, wherever it sits. Examples are a heading not in the schema, or text before the first section. On read, it is exposed as `other` (a Markdown string), in original order. It is not a warning. If a schema section is removed later, its marked content becomes part of `other`; it is never deleted.

### 3.2 Engine API

Implement this in one module, `src/markdown/sections.ts` or similar, replacing `structured-sections.ts` and `section-titles.ts`:
- `parseSections(body, schema)` returns `{ sections: Record<id, MarkdownValue | ChecklistItem[] | LogEntry[]>, other: string }`
- `setMarkdown(id, text)`, `appendMarkdown(id, text)`
- `checklistAdd(id, text)`, `checklistCheck(id, n)`, `checklistUncheck(id, n)`, `checklistRemove(id, n)`
- `logAppend(id, {author, date, body, auto?})`
- `serializeSections(parsed, schema)`, which keeps `other` content in place

Log sections are **append-only**. There is no edit or delete operation anywhere in the CLI, API or UI.

### 3.3 Checklist numbering
Items are numbered `#1…#n` in order of appearance. Removing an item renumbers the rest, keeping the current acceptance-criteria behavior.

### 3.4 Automatic change entries
When a field with `track_changes: true` changes through any write path, append an entry to the **first** `log` section in the schema. It has `auto: true`, and the author is the acting user (the `--author` value or the default user). The body is `<label>: <old or ∅> → <new or ∅>`. If the schema has no log section, skip silently.

---

## 4. Field registry (single access layer)

Create `src/schema/` containing the schema loader and validator, plus a **field registry** with:
- `getField(task, key)`
- `setField(task, key, value)`, which validates and normalizes
- `clearField(task, key)`
- `parseInput(key, raw: string)`, for CLI and API string input
- `matches(task, condition)`, for `--where`
- `compare(key, a, b)`, for `--sort`
- `format(key, value, mode: "plain" | "json")`

Core fields map to the existing typed `Task` properties (`status`, `assignee`, `dueDate` and so on). Non-core fields map to a generic values map on the task. **Every consumer goes through the registry**: CLI create, edit and list, JSON output, the server API, filtering and sorting, and the web UI. Do not add new code that reads `task.priority` or similar directly for display or filtering. Existing internal logic, such as status-based board columns, may keep its typed access.

Replace Codex's custom-field-only code paths (`fields.yml` loader, `customFields` handling, `backlog fields`) with the registry. Reuse its tested logic, such as `--where` parsing, relative dates and enum normalization, where it fits.

---

## 5. Surfaces

### 5.1 CLI

**Schema**
- `backlog schema [--json]` prints the users, fields (with every attribute), sections and ui blocks. It replaces `backlog fields`.
- `backlog schema validate` validates the schema and every task against it.

**Fields: one interface for every field**
- `--field key=value` (repeatable) on `task create`, `task edit`, `draft create` and `draft edit`.
- `--clear-field key` (repeatable) on edit.
- For list types, `--field labels=a,b` replaces the whole list. `--add key=value` and `--remove key=value` (repeatable) add or remove individual list items for any list-type field.

**Shortcut flags**
The existing flags stay as **aliases** that map to `--field`: `-s/--status`, `-a/--assignee`, `--priority`, `--type`, `--project`, `-l/--labels`, `--milestone`, `-p/--parent`, `--dep`, `--due-date`, `--clear-due-date`, `--reporter` and `--ordinal`. Implement each as a thin mapping onto the registry, with no separate validation logic.

**Sections**
- `--section id=text` replaces a markdown section, and `--append-section id=text` appends to one.
- `-d/--description` is an alias for `--section description=…`, and only works when a section with ID `description` exists.
- `--check id:n`, `--uncheck id:n`, `--add-item id=text` and `--remove-item id:n` edit checklists.
- `backlog task log <taskId> "text" [--section <logId>] [--author @x] [--date YYYY-MM-DD]` adds a log entry. `--comment "text"` on `task edit` is an alias for adding to the first log section, and `--comment-author` is an alias for `--author`.

**Removed flags:** `--ac`, `--check-ac`, `--uncheck-ac`, `--remove-ac`, `--dod`, `--check-dod`, `--uncheck-dod`, `--remove-dod`, `--no-dod-defaults`, `--plan`, `--append-plan`, `--notes`, `--append-notes`, `--final-summary`, `--append-final-summary` and `--clear-final-summary`. Each prints an error naming its replacement.

**List**
- `task list --where key<op>value` accepts any filterable field, built-in or not. It keeps Codex's grammar: `=`, `!=` and `key=a|b` for all types; `<`, `<=`, `>` and `>=` for `date` and `datetime`; `key=` for unset and `key!=` for set; and `today`, `+Nd` and `-Nd`.
- For list types, `key=value` means "contains."
- `--sort key[:asc|:desc]` and `--show-fields k1,k2` work on any field.
- The existing filter flags stay as aliases.

**Plain detail output** shows fields in schema order (non-hidden fields with values), then each section by its title, then "Other" if it's non-empty.

### 5.2 JSON (bump to `schemaVersion: 2`)
- **Compact task objects:** `id`, `title`, `fields` (an object containing **every** schema field that has a value, keyed by frontmatter key, including core fields), and `unknownFields`.
- **Task view** adds `path`, `sections` (keyed by section ID: a string for markdown, `[{index, text, checked}]` for checklists, `[{author, date, createdAt, auto, body}]` for logs) and `other`.
- Remove the old top-level per-field properties and `customFields` from the CLI JSON contract.
- `schema --json` returns `kind: "schema"`.
- Update `CLI-INSTRUCTIONS.md` § Stable JSON output to describe version 2.

### 5.3 Server API (`src/server/index.ts`)
- `GET /api/schema` returns the full schema, the same content as `schema --json`.
- Task responses carry `fields`, `sections` and `other`, in the same shapes as CLI JSON v2. They can also keep the legacy typed properties the existing web code still needs while it's being migrated; remove those once the frontend tasks are done.
- `POST /api/tasks` and `PATCH /api/tasks/:id` accept:
  ```json
  { "fields": {"status": "Done", "side": "us", "uat_date": null},
    "sections": {"description": "…", "description_ja": "…"},
    "checklist": [{"section": "acceptance", "op": "check", "index": 2}],
    "log": {"section": "log", "body": "…", "author": "@alice", "date": "2026-10-24"} }
  ```
  `null` clears a field. Validation goes through the registry and section engine; errors return 422 with `{errors: [{key, message}]}`.
- Update every other endpoint that reads or writes removed config keys or sections (config, statuses, drafts, milestones, statistics, search) so it works with the schema.
- The Settings endpoint keeps editing whatever `config.yml` keys remain (port, editor, auto-open and so on). It returns the schema read-only.
- The WebSocket live-update behavior is unchanged. It must also fire when `task-schema.yml` changes, and the UI then re-fetches the schema.

---

## 6. Web UI requirements

### 6.1 Style rules (mandatory)
1. **No new visual language.** Every new or changed element copies its markup and Tailwind classes from an existing component that does the same job:
   - **Select and text inputs in the detail sidebar:** the existing `<select>` and input blocks in `TaskDetailsModal.tsx` (the sidebar controls for priority, type and project, around lines 1760–1950 at v1.55.1).
   - **Multi-value inputs:** `ChipInput.tsx`.
   - **Task references:** `DependencyInput.tsx`.
   - **Card badges for enum values:** the `TaskTypeBadge.tsx` / `ProjectBadge.tsx` pattern. Generalize them into one `EnumBadge`.
   - **Dates:** `StoredDate.tsx` and `utils/date-display.ts`.
   - **Filter controls:** the existing board filter bar and `LabelFilterDropdown.tsx`.
   - **Table cells and headers:** the existing `TaskList.tsx` cells, including its sort header behavior.
   - **Markdown editing and preview:** the existing editor used for the description.
   - **Checklists:** `AcceptanceCriteriaEditor.tsx` / `AcceptanceCriteriaProgress.tsx`, generalized.
   - **Log list and add form:** the existing comments list and add-comment form, generalized. Add an author `<select>` built from the users block (default selected) and a date input (default today), styled like the existing inputs.
2. **No additions to `src/web/styles/source.css`,** no inline `style=` attributes, and no new colors, fonts, spacing scales, shadows or radii. Use only Tailwind classes already present in sibling components.
3. Every element works in **dark mode**, matching the `dark:` variants of the component it was copied from.
4. Keep spacing, alignment and density consistent with neighbors. A new field row in the sidebar must be indistinguishable in style from the existing priority row.
5. No new routes, pages, modals or navigation entries.
6. Put reusable pieces in new files under `src/web/components/schema/`. The existing large components should shrink as hard-coded field code is replaced by the generic components.

### 6.2 Generic components (new)
- `SchemaProvider`, a React context: it fetches `/api/schema`, re-fetches on live updates, and exposes the schema plus helper functions.
- `FieldValue` (props: `fieldKey`, `value`, `variant: "card" | "cell" | "detail"`) is the read-only display for every type. Enums render as `EnumBadge` on cards and as text in cells. Bools render as a check icon or "–" in cells and as a badge with the label on cards (shown only when true). Users render as the existing assignee display. Dates use `StoredDate`. Lists render as chips.
- `FieldInput` (props: `fieldKey`, `value`, `onChange`, `error`) is the edit control by type. Managed fields render read-only.
- `FieldFilter` (props: `fieldKey`, `value`, `onChange`) is the filter control by type, built from the existing filter-bar controls.
- `SectionBlock` (props: `sectionId`, `value`, `mode`) renders a markdown, checklist or log section in view or edit mode, using the existing editors.
- `OtherContent` renders `other` as read-only Markdown under the heading "Other". It is hidden when empty.

### 6.3 Screen-by-screen changes

| Screen | Change |
|---|---|
| **Board: cards** (`TaskCard.tsx`) | Replace the hard-coded type, project, priority, labels, assignee and date displays with `ui.board.card` rendered through `FieldValue variant="card"`, in the configured order. Keep the card's layout zones; badges stay in the badge row and people stay where the assignee is now. |
| **Board: filter bar** (`BoardPage.tsx`, `Board.tsx`) | Build the filters from `ui.board.filters` using `FieldFilter`. Keep URL-parameter persistence, using one URL parameter per field key. Columns still come from `status` values. Milestone lanes keep working. |
| **Task list** (`TaskList.tsx`) | Build the columns from `ui.task_list.columns` and the filters from `ui.task_list.filters`. Every column is sortable through the registry's compare function. Keep the existing horizontal-scroll behavior. |
| **Task detail / edit** (`TaskDetailsModal.tsx`) | The sidebar shows **all** non-hidden fields in `ui.detail.order` or schema order, as `FieldInput` in edit mode and `FieldValue variant="detail"` in view mode. A translation field sits directly under its source field, with its `lang` shown as a small label. The main column shows **all** sections in schema order as `SectionBlock`, with each translation section directly after its source section, then `OtherContent`. Saving sends one PATCH. Validation errors show inline under the field, using the existing error text style. Remove all hard-coded field and section code. |
| **Create task / draft** (same modal, create mode) | Same as edit mode. Defaults come from the schema; required fields are marked using the existing required-indicator style, or a plain `*` if none exists. |
| **Milestones** (`MilestonesPage.tsx`, `MilestoneTaskRow.tsx`) | Row fields come from `ui.milestones.row`, rendered through `FieldValue variant="cell"`. |
| **Drafts** (`DraftsList.tsx`) | Inherits the detail and create behavior; fix anything broken by the changes. |
| **Statistics** | It must render. Where it uses status or priority, read them through the registry. |
| **Settings** | Remove the controls for keys that moved to the schema. Keep the remaining controls working. Add a read-only "Task schema" panel that lists users, fields (key, label, type, values) and sections, styled like the existing Settings panels, with a note that the schema is edited in `task-schema.yml`. |
| **Docs, Decisions, Initialization screen, others** | They must render without errors. The initialization flow must create a project with the default schema. |

### 6.4 Language toggle
- Add a global **language toggle** to the existing top navigation, styled like the existing theme toggle. Its options are the distinct `lang` values in the schema, and it is hidden when the schema has fewer than two.
- When a language is selected, every place that shows a field or section with translations shows the variant in that language **if it has a value**, otherwise the source. This covers cards, table cells and the title.
- The detail and edit view always shows both variants.
- The choice is stored in `localStorage`, wrapped in try/catch.

---

## 7. Tasks (execute in order; each ends with green checks and a commit)

**Checks for every task:**
- `bun run check` and `bun run check:types` pass.
- `bun test` shows no new failures versus `NOTES-baseline.md`. Tests for removed features are deleted, and each deleted test file is listed in the task's notes.
- `bun run build` succeeds.

Write a short completion note for each task in `PROGRESS.md`: what was done, any decisions taken, and what broke in the TUI/MCP.

### Task 1: UI and code audit (no behavior change)
Produce `AUDIT.md` containing:
1. For every web screen and component: each task field and body section it reads or writes, with file:line, the control or display it uses, and which generic component (§6.2) will replace it.
2. Every server endpoint that touches fields, sections or the config keys being moved.
3. Every CLI command or flag that touches them.
4. Every TUI and MCP file that will need minimal compile fixes.
5. **Baseline visual review** of each screen (board, task list, task detail view and edit, create, milestones, drafts, statistics, settings), in light and dark mode. Use a synthetic sample project of 10 tasks that exercises every built-in field and section. Keep any captures outside the repository.
6. The exact current contents of each UI area, for writing `ui` defaults that reproduce today's UI.

**Done when:** `AUDIT.md` and the screenshots are committed. Post a summary and **continue without waiting**, unless the audit contradicts this plan; in that case **[ASK]**.

### Task 2: Schema loader and validator
`src/schema/` covers the loader, the types from §2.3, validation of every rule in §2, the default schema file, the example schema, `backlog init` writing `task-schema.yml`, the removal of moved `config.yml` keys (§2.7), and `backlog schema` / `schema validate`.

Tests cover each validation rule (one passing and one failing case each): core-field removal, a type change on a core field, bad enum defaults, an unknown key in `ui`, a non-filterable type in filters, a dangling `translation_of`, a missing default user, and the leftover-config-key error.

### Task 3: Field registry and CLI fields
- Implement §4, and route CLI create, edit, list, view, plain output and JSON through the registry.
- `--field`, `--clear-field`, `--add` and `--remove` for every field; the shortcut flags as aliases; `--where`, `--sort` and `--show-fields` for every field; users validation; JSON v2 fields.
- Replace Codex's custom-field code.

Tests:
- Every type round-trips.
- Built-in and custom fields behave identically through `--field`.
- The aliases equal their `--field` equivalents.
- Invalid writes leave files unchanged.
- A status-only edit changes only the `status` and `updated_date` lines.

### Task 4: Section engine and CLI sections
- Implement §3 and the section parts of §5.1, and remove the hard-coded sections, their flags and the Definition-of-Done config.
- Implement `task log`, `--comment` as an alias, automatic `track_changes` entries, `other` preservation and JSON v2 `sections` / `other`.

Tests:
- Each section kind round-trips.
- Checklist operations renumber correctly.
- Log entries are append-only, with `date` defaulting to today and `created` always set.
- An unknown author is rejected.
- A `---` line in a log body is rejected.
- Content outside markers survives every edit byte-for-byte.
- Removing a section from the schema moves its content to `other`.
- Removed flags print their replacement.

### Task 5: Server API
- Implement §5.3.
- API tests cover `GET /api/schema`, PATCH with mixed core and custom fields, section and checklist and log operations, 422 errors, and a schema-file change triggering a live update.
- Fix the endpoints the audit listed.

### Task 6: Frontend foundation
Build `SchemaProvider`, `FieldValue`, `FieldInput`, `FieldFilter`, `EnumBadge`, `SectionBlock` and `OtherContent` under `src/web/components/schema/`, following §6.1. Add unit tests in the style of the existing `src/web` tests: one per type for `FieldValue` and `FieldInput`, and one per kind for `SectionBlock`.

### Task 7: Board (cards and filters)
Implement the board rows of §6.3. With the **default** schema, preserve the baseline board layout. Review it before and after with synthetic data. With the **example** schema, the custom fields appear on cards and in filters.

### Task 8: Task list
Implement the task list row of §6.3, with the same before/after comparison and the example-schema check.

### Task 9: Task detail, edit and create
Implement the detail, edit and create rows of §6.3. This is the largest task, so split the commits: sidebar fields, then sections, then the log form, then create mode. With the default schema, the only intended visual differences from the baseline are:
- the removed dev sections
- the generalized checklist titled "Acceptance Criteria"
- the "Log" section replacing "Comments", with the author and date inputs added

Everything else must match.

### Task 10: Remaining screens
Make milestones rows configurable; get the Drafts, Statistics, Settings (with the read-only schema panel), Docs, Decisions and Initialization screens rendering and working; and complete the TUI/MCP compile fixes.

### Task 11: Language toggle
Implement §6.4, and test it with the example schema (`title` / `title_ja`, `description` / `description_ja`).

### Task 12: Documentation and agent guidance
- Update `CLI-INSTRUCTIONS.md`, `README.md` (add a fork section at the top) and `ADVANCED-CONFIG.md`.
- Add `docs/TASK-SCHEMA.md`, a complete reference of every schema attribute with examples.
- Update the built-in agent guides in `src/guidelines/` so `backlog instructions overview` tells agents to:
  - run `backlog schema --json` first
  - use `--field`, `--where`, `--sort` and `--show-fields` for every field
  - use `--section`, `--check` and `task log` for sections
  - never edit task files by hand
  - copy enum values and user handles exactly
- Add `docs/examples/AGENTS.md.template` for users' data repositories. It covers the tool, startup commands, rules, and a "common requests → commands" table written against the fictional example schema.

### Task 13: Verification and release
1. Run the full test suite and record the results against the baseline.
2. Write `ACCEPTANCE-2.md`: an end-to-end scenario with the **example** schema on a fresh project in `/tmp/schema-accept`. It must cover:
   - creating tasks with core and custom fields through `--field` only
   - every `--where` operator, including on `status` and `assignee`
   - sorting on a custom enum and a custom date
   - section, checklist and log operations, including `--date` backdating and an automatic `track_changes` entry
   - `other` preservation after a hand-added `## Notes` heading
   - an invalid write rejected with the file unchanged
   - `schema validate` catching a broken reference
   - JSON v2 output samples
3. Review every screen in light and dark with the fictional example schema and record a short visual review note. Keep any captures outside the repository.
4. Build `dist/backlog`, check that `--version` reports `1.55.1-cf.2`, run `schema --json`, and tag `v1.55.1-cf.2`.
5. Update `TECHNICAL-HANDOFF.md` to describe the new state.

---

## 8. Rules
- Follow the patterns already in the codebase. Don't refactor unrelated code.
- Never weaken a test to make it pass. Only delete tests for features this plan removes, and list them.
- Keep commits small, one concern each, at least one per task.
- **[ASK]** and stop if:
  - a design rule here conflicts with how the code works in a way that forces a different design
  - reproducing the current UI with the default schema turns out to be impossible for some area
  - removing a hard-coded section would break a screen this plan says must keep working, with no simple fix
