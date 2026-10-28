# Task schema audit (before behavior changes)

Base: `v1.55.1-cf.1` (`c645ca5`). The browser reference project was a synthetic ten-task sample with one milestone and one draft, served by the built app for visual review. The sample files and captures were removed from this public repository; new visual checks should use fictional data and keep captures outside the repository.

## Storage and design discrepancy requiring owner choice

The actual frontmatter writer is `src/markdown/task-frontmatter.ts:4-27`, called by `src/markdown/serializer.ts:51-56`. It writes `subtasks` and camel-case `onStatusChange`; it does **not** write `branch`. `src/markdown/parser.ts:148-155` reads `subtasks` and `onStatusChange`; `branch` comes from cross-branch task lookup and is a transient read-only property. The plan's *expected* list instead includes `branch` and snake-case `on_status_change` but omits `subtasks`. The owner decided to keep all actual persisted keys as core and make access go through the canonical field object. `branch` keeps its computed, read-only behavior and will be exposed through that access layer without writing it as frontmatter.

Two more default-schema conflicts were resolved by the owner. First, `TaskList.tsx:864-875` renders a sortable `Ordinal` column, while the plan says `ordinal` is hidden and disallows hidden fields in `ui.task_list.columns`. The owner chose to keep the column, so `ordinal` will be non-hidden, managed and read-only in detail. Second, fresh projects have no configured projects (`src/utils/project-config.ts`), while the plan makes `project` an enum and requires every enum's `values` list to be nonempty. The owner chose a narrow exception allowing empty values for optional core `project`, plus explanatory boilerplate in the shipped schema.

The plan's `datetime` row shows `YYYY-MM-DD HH:mm`, while existing managed timestamps are stored as ISO UTC strings (for example `2026-10-22T10:33:00Z` in the sample). The plan separately requires unchanged built-in storage. The loader and registry will preserve ISO UTC for `created_date` and `updated_date`; the new custom `datetime` input format can follow the table.

## Exact current UI areas and migration map

`FV`, `FI`, `FF`, `SB` below mean the planned `FieldValue`, `FieldInput`, `FieldFilter`, and `SectionBlock`. All displays and controls named here are hard-coded today. Unless stated otherwise, data is read from typed `Task` properties.

| Screen / component | Current fields and controls, in visual order | Current body data | Replacement |
|---|---|---|---|
| Board card, `src/web/components/TaskCard.tsx:83-86,156-164,202-290` | Branch ribbon (derived read-only), ID, type badge, project badge, acceptance progress, priority badge and colored border, title, up to three label chips, created and updated dates, due date, assignee. Status is the enclosing column. | Acceptance checklist progress through `AcceptanceCriteriaProgress.tsx:1-100`. | `FV` for card metadata, generic checklist progress, retain branch and status layout logic. |
| Board filters and columns, `src/web/components/Board.tsx:240-296,485-545,742-809`; URL state in `BoardPage.tsx:109-219` | Filters: assignee, labels, type, project (only when configured), priority. Status values define columns. Separate lane mode and milestone selector govern grouping. URL keys are `assignee`, `label`, `priority`, `type`, `project`, `lane`, and `milestone`. | None. | `FF` in schema filter order; keep lane and milestone grouping and URL persistence. |
| Task list, `src/web/components/TaskList.tsx:141-161,385-453,738-825,857-1010` | Filters: included status, excluded status, priority, milestone, labels. Columns: ID, Title (acceptance progress and due date inside cell), Status, Priority, Ordinal, Labels, Assignee, Milestone, Created. Sortable headers: ID, Title, Status, Priority, Ordinal, Milestone, Created. | Acceptance progress in title cell. | `FF` for filters; `FV` for cells and generic checklist progress. Preserve due date in title cell and horizontal scrolling. |
| Task detail / create modal, `src/web/components/TaskDetailsModal.tsx:123-129,224-246,812-848,1119-1245,1710-1910` | Header ID/title and branch warning. Sidebar: created/updated/due date display; due date input in edit; title input in edit; status select; type select; assignee and labels `ChipInput`; priority select; project select if configured; milestone select; dependencies `DependencyInput` and readiness; archive action. Several controls save immediately through `handleInlineMetaUpdate` (`:910-960`), while main Save sends a combined create/update payload (`:810-848`). | Main column described below. | `FI`/`FV` in schema order; one PATCH on Save; keep archive, branch warning, hierarchy and dependency graph behavior. |
| Detail main column, `TaskDetailsModal.tsx:1250-1700` | References, modified files and documentation have dedicated lists/edit controls (`:1340-1510`); these are currently frontmatter fields presented in the main column, not sidebar. Subtask hierarchy and dependency graph are computed displays. | Description markdown editor/preview (`:1250-1285`); Acceptance Criteria checklist (`:1515-1535`); Definition of Done checklist (`:1537-1576`); Implementation Plan markdown (`:1580-1603`); Implementation Notes markdown (`:1605-1628`); Comments list/add form (`:1630-1680`); Final Summary markdown (`:1681-1700`). | Move all frontmatter to `FI`/`FV` sidebar; configured `SB` instances for sections; `OtherContent` for unconfigured body. Preserve computed hierarchy/graph. |
| Draft list, `src/web/components/DraftsList.tsx:136-182` | ID, title, priority badge, created/updated dates, assignees, labels, promote button. Draft create/edit uses the same detail modal through `src/web/App.tsx:1071`. | No body preview on list. | `FV` for shown data; generic detail modal for edit/create. |
| Milestones, `src/web/components/MilestonesPage.tsx:427-470,625-640,708-723`; `MilestoneTaskRow.tsx:43-69` | Per-task row: ID, title, status badge, priority badge; `MilestonesPage` groups by task milestone and status, uses created date for order, and moves tasks between milestones. Milestone entity title and due date are separate from task fields. | None. | `FV` for configured row fields, retaining milestone entity controls. |
| Statistics, `src/web/components/Statistics.tsx:139-155,237-247,347-400,413-530` | Task ID/title/status and created/updated dates for recent activity; status and priority counts and task health lists from `/api/statistics`. | None. | Registry reads for task values and schema values for status/priority ordering. |
| Settings, `src/web/components/Settings.tsx:13-95,152-450` | Edits `projectName`, date format, auto-commit, remote operations, default status, editor, Definition of Done defaults, port, auto-open, hide-empty columns, max-column width, resolution strategy, zero-padding and prefixes. Reads `/api/statuses` for default status. | None. | Remove default-status and DoD controls; schema panel; retain other config controls. |
| App/navigation, `src/web/App.tsx:290-301,345-357,937-1071`; `Navigation.tsx`, `SideNavigation.tsx` | Routes, task count, detail-modal loading and task updates; no independent task field editor. | None. | Wrap app in `SchemaProvider`; refresh on schema live-update. |
| Docs, Decisions, Initialization, `src/web/components/DocumentationDetail.tsx`, `DecisionDetail.tsx:255-343`, `InitializationScreen.tsx:735-746` | Docs and Decisions use their **own** record fields, not task sections; Decisions has its own status. Initialization configures the task prefix and calls `/api/init`. | No task body editor. | Preserve rendering; init must write default task schema. |

Supporting components with task coupling:

| Component | Current coupling | Replacement |
|---|---|---|
| `TaskColumn.tsx:37,93,130,137-145,326-401` | Created-date and priority sorting, branch read-only check, status badge/drag target, task ID. | Registry compare for sortable fields; keep branch/drag behavior. |
| `TaskTypeBadge.tsx:66-80`, `ProjectBadge.tsx:14-44` | Dedicated enum badge palettes and configured options. | Shared `EnumBadge`, called by `FV`. |
| `AcceptanceCriteriaProgress.tsx:15-43`, `AcceptanceCriteriaEditor.tsx:19-122` | Reads acceptance checklist and edits both acceptance and DoD items. | Generic checklist progress and `SB` checklist editor. |
| `DependencyInput.tsx:72-75,158-219`, `DependencyGraphSection.tsx:57` | Task ID/title suggestions and dependency-chip display; graph node status. | `FI` for task-ref lists, retaining suggestion/graph behavior. |
| `SideNavigation.tsx:404-406,429-447,522-572` | Search accepts dedicated task filters; result dropdown shows task ID/title. | Search API/registry integration; `FV` for task result display if expanded. |
| `CleanupModal.tsx:146-153` | Task ID/title/updated-or-created date in cleanup preview. | `FV` for displayed task values, retain cleanup action. |

Other web components are generic shell controls or display Document, Decision, and Milestone records rather than task fields. They should compile and render after the task API shape changes.

### Exact `ui` defaults needed for visual parity

The illustrative `ui` block in plan §2.5 omits some existing displays. The actual default needs to account for:

- `board.card`: type, project, priority, labels, `created_date`, `updated_date`, `due_date`, assignee; ID and title are always shown. Acceptance progress and priority border are extra card behavior. The default filter order is assignee, labels, type, project (conditional), priority; milestone is part of lane grouping.
- `task_list.columns`: title, status, priority, **ordinal**, labels, assignee, milestone, `created_date`; ID is always shown. Due date and acceptance progress are inside the title cell, not standalone columns. Filter order is status, excluded status, priority, milestone, labels.
- `milestones.row`: status, priority after ID and title.
- `detail.order`: the current sidebar order is due date, title (edit only), status, type, assignee, labels, priority, project (conditional), milestone, dependencies, with created/updated metadata at top. References, modified files and documentation currently live in the main column. The plan explicitly requires *all* non-hidden fields in the sidebar, so this area will necessarily change.

## Server routes and backing code

| Route / operation | Current dependency | Planned change |
|---|---|---|
| `GET/POST /api/tasks`, `GET /api/task/:id`, `GET/PUT /api/tasks/:id`, `src/server/index.ts:424-434,730-820,981-1205` | Typed task fields, custom fields, fixed body sections, status/label filters. | Return `fields`/`sections`/`other`; registry and section validation; add PATCH with 422 errors. |
| `GET /api/statuses`, `GET/PUT /api/config`, `:441-447,1316-1375` | Config status list and editable moved keys. | Status from schema; schema read-only in config response; reject moved keys on update. |
| `GET /api/drafts`, promote, demote, archive, `:435-439,479-484,1256-1306,1670-1700` | Typed task/draft representation and default status. | Schema-aware task shape and defaults. |
| Milestone routes and task move/reorder, `:485-508,1690-1902` | Task `milestone`, `status`, `ordinal`, and rename/reassignment. | Registry validation for task writes; preserve move behavior. |
| Search, `:530-532,818-976` | Dedicated status, priority, project, labels filters. | Schema fields/filters and v2 task response. |
| Statistics, `:521-523,1995-2020` | Config statuses/priorities and typed task data. | Schema values for aggregation. |
| Init/status/live updates, `:524-530`; filesystem watcher in `src/server/index.ts` | Init writes config; watcher follows task/config changes. | Write and watch `task-schema.yml`, then notify clients. |

Task persistence is centralized in `src/file-system/operations.ts:950-990,1062-1104,2353-2528`; task parse/serialize in `src/markdown/parser.ts:82-155` and `serializer.ts:51-105`. The old `fields.yml` loader is `src/utils/custom-fields.ts:208`.

## CLI commands and flags

`src/cli.ts` is the main CLI surface. `fields` (`:1087-1122`) reads `fields.yml` and becomes `schema`. Init and its wizard/config prompts are `:1125-1950`; config get/set/list are `:5410-5888`.

| Command | Current field/section interface |
|---|---|
| `task create`, `:2017-2237` | `--description`, status, assignee, labels, priority, type, project, `--field` for **custom only**, due date, acceptance, DoD, plan, notes, final summary, ordinal, milestone, parent, dependencies, references and documentation. |
| `task list`, `:2740-3142` | Dedicated status, excluded-status, assignee, milestone, parent, priority, type, project, labels filters; custom-only `--where` and `--show-fields`; fixed-field `--sort`; search/ready; JSON v1. |
| `task edit`, `:3180-4039` | Dedicated flags for the fields above, custom-only `--field`/`--clear-field`, checklist operations, plan/notes/summary mutations, comments, references, modified files, documentation. |
| `task view`, `:4042-4085` | Fixed plain sections and JSON v1 through `src/formatters/task-plain-text.ts` and `json-output.ts`. |
| `draft list/create/edit/promote/view`, `:4275-4515` | Reuses task code but has separate creation/edit flags and Draft status. |
| `search`, `:2240-2435` | Dedicated task status/type/project/priority/labels filters. |
| `milestone`/`board`, `:4523-4850` | Reads/writes task milestone, status, ordinal during navigation and reassignment. |

The old config parser and writer handle moved keys at `src/file-system/operations.ts:2392-2422,2482-2528`; `src/types/index.ts:372-385` defines them. `src/formatters/json-output.ts:137-207` hard-codes current task JSON and sections. `src/utils/task-sorting.ts:190-230` has a custom-field branch beside built-in sorting.

## TUI and MCP compile-impact inventory

The TUI's task fields and sections are read in `src/ui/task-viewer-with-search.ts:73-84,1604-1805`, `src/ui/board.ts:162-170,444,1197-1282`, `src/ui/acceptance-criteria-progress.ts:37-54`, `src/ui/task-row-prefix.ts:37`, and `src/ui/unified-view.ts:250`. These will need type/contract fixes as `Task` and config change; runtime parity is outside stage 1.

MCP task formatting is in `src/mcp/tools/tasks/handlers.ts:95-102`; milestone task mutations in `src/mcp/tools/milestones/handlers.ts:308-608`; config-based status schemas in `src/mcp/utils/schema-generators.ts:13-24`; DoD-specific MCP handling in `src/mcp/tools/definition-of-done/handlers.ts:36-37`. Other MCP tools import the legacy task update inputs, so compiler errors after Tasks 3-4 should be resolved narrowly.

## Baseline capture notes

The sample has 10 active tasks, one draft and one milestone, with different statuses, priorities, custom fields, labels, assignees, a due date, dependency, references, documentation and modified files. `TASK-10` exercises every visible legacy body section. `TASK-1` additionally has `reporter`, `subtasks`, and `onStatusChange`, and `TASK-9` has `parent_task_id`; these internal fields were added through `FileSystem.saveTask` because the CLI has no flags for them. Browser screenshots cover nine states in light and dark mode at 1440×900, plus lower-scroll captures of detail view and edit. `branch` is derived cross-branch state and cannot be created as local task frontmatter through the CLI.
