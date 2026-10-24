# Known failures during the schema migration

This ledger tracks failures beyond the 19 failures recorded in the pre-schema baseline at commit `c645ca5`. A task gate permits only those baseline failures and entries explicitly assigned below. Each task removes its entries before its closure commit. By the end of Task 10, this ledger must contain no active failures.

## Active failures

The Task 4 diagnostic full-suite run at `3aefddf` exposed fixture migrations and two additional server API contracts. The active ledger below assigns those contracts to Task 5. All ten former Task 4 entries were cleared by the generic section engine and migrated tests.

### Task 5 — server schema/API and live-update paths (18)

- `src/test/server-statistics-endpoint.test.ts` — `BacklogServer statistics endpoint > reuses branch state while reconciling cached working-copy tasks across statistics requests` — Task 5: statistics must load tasks and metadata with the active schema.
- `src/test/server-statistics-endpoint.test.ts` — `BacklogServer statistics endpoint > keeps board work blocked by an unfinished archived dependency without counting that dependency` — Task 5: statistics readiness needs schema-backed task loading.
- `src/test/server-statistics-endpoint.test.ts` — `BacklogServer statistics endpoint > uses fresh priorities without rebuilding the task corpus` — Task 5: priority values moved from config to the schema.
- `src/test/server-statistics-endpoint.test.ts` — `BacklogServer statistics endpoint > reconciles a selected backlog root before reading its statistics` — Task 5: root reconciliation must include the selected schema.
- `src/test/server-statistics-endpoint.test.ts` — `BacklogServer statistics endpoint > refreshes statistics after an active branch ref moves` — Task 5: branch statistics must use schema-backed metadata after refresh.
- `src/test/server-statistics-endpoint.test.ts` — `BacklogServer statistics endpoint > keeps task and config generations coherent during a same-root config change` — Task 5: generation coherence must include schema changes.
- `src/test/server-cleanup-endpoint.test.ts` — `BacklogServer cleanup endpoints > previews and executes cleanup for the final configured status` — Task 5: cleanup must read final status from the schema.
- `src/test/server-cleanup-endpoint.test.ts` — `BacklogServer cleanup endpoints > archives only the tasks the preview showed` — Task 5: cleanup preview and execution must share schema-backed status rules.
- `src/test/server-cleanup-endpoint.test.ts` — `BacklogServer cleanup endpoints > skips a previewed task that left the final status before the click` — Task 5: cleanup must recheck the schema-backed final status.
- `src/test/content-store.test.ts` — `ContentStore > reconciles stopped current-root watchers after a root transition is superseded` — Task 5: content-store root watchers must include schema state.
- `src/test/content-store.test.ts` — `ContentStore > retries public root reconciliation when content loading fails after watchers bind` — Task 5: schema-aware root reconciliation must recover after load failure.
- `src/test/content-store.test.ts` — `ContentStore > publishes coherent A to B to A snapshots and rebinds every root watcher` — Task 5: snapshots and watchers must carry each root's schema.
- `src/test/content-store.test.ts` — `ContentStore > rebinds both config and content watchers when browser initialization selects a custom root` — Task 5: browser root selection must bind its schema watcher too.
- `src/test/server-tasks-spa-fallback.test.ts` — `BacklogServer task SPA fallback > keeps config and duplicate-task reads fail-closed while a watched config is unusable` — Task 5: server watcher validation must handle config and schema separately.
- `src/test/shared-branch-task-loader.test.ts` — `shared immutable branch task loading > returns statistics metadata from the same stable config generation as its tasks` — Task 5: branch loading must keep schema and task generations coherent.
- `src/test/config-watcher.test.ts` — `config watcher > retains the cached defaultAssignee while an inline edit is not a usable assignee value` — Task 5: default user moved to the schema's `users` block.
- `src/test/config-watcher.test.ts` — `config watcher > publishes root config resolution from the same accepted content` — Task 5: watcher acceptance must track schema and config together.
- `src/test/config-watcher.test.ts` — `config watcher > keeps accepting the sparse config shape supported by the parser` — Task 5: watcher validation must accept config without moved schema keys.

## TUI/MCP exclusions

TUI/MCP not upgraded – owner decision 2026-10-24. These previously failing tests are retained and marked skipped. No TUI test failed in the diagnostic full-suite run.

- `src/test/mcp-definition-of-done-defaults.test.ts`
  - `MCP Definition of Done default tools > round-trips quoted and multiline DoD defaults without injecting config keys`
- `src/test/mcp-roots-discovery.test.ts`
  - `MCP roots discovery > skips a root whose config value is rejected and keeps examining later roots`
- `src/test/mcp-task-project-filtering.test.ts`
  - `MCP task project filtering adapter > exposes configured project arrays in list and search schemas`
  - `MCP task project filtering adapter > reuses OR filtering and canonical casing for task_list`
  - `MCP task project filtering adapter > supports project-only and text-plus-project task_search calls`
  - `MCP task project filtering adapter > validates filters against configured projects`
  - `MCP task project filtering adapter > applies the same project filter to drafts`
- `src/test/mcp-task-type-filtering.test.ts`
  - `MCP task type filtering adapter > exposes configured type arrays in list and search schemas`
  - `MCP task type filtering adapter > reuses OR filtering and canonical casing for task_list`
  - `MCP task type filtering adapter > supports type-only and text-plus-type task_search calls`
  - `MCP task type filtering adapter > validates filters against configured task types`
  - `MCP task type filtering adapter > applies the same type filter to drafts`
- `src/test/mcp-tasks.test.ts`
  - `MCP task tools (MVP) > edits tasks including plan, notes, dependencies, and acceptance criteria`
  - `MCP task tools (MVP) > creates and edits Definition of Done items`
  - `MCP task tools (MVP) > renders every task result through the one plain serializer`
  - `MCP task tools (MVP) > treats an explicit empty assignee as unassigned in task_create and task_edit`
  - `MCP task tools (MVP) > appends and renders task comments through task_edit and task_view`
  - `MCP task tools (MVP) > filters task_list to unassigned tasks and rejects combining with assignee`
  - `MCP task tools (MVP) > applies unassigned filtering in task_list draft status path`
  - `MCP task tools (MVP) > exposes configured priority enums and accepts custom priority values`
  - `MCP task tools (MVP) > exposes task type enums from configuration without a default`
  - `MCP task tools (MVP) > creates and edits tasks with a project when configured and shows it in view and list output`
- `src/test/task-list-order.test.ts`
  - `task list order across surfaces > lists the same sections in the same order through MCP task_list`
  - `task list order across surfaces > keeps the MCP limit on the rows as they print, section by section`
- `src/test/task-search-parity.test.ts`
  - `filter wiring across surfaces > requires every label through the MCP task_list labels argument`
  - `filter wiring across surfaces > matches MCP labels case-insensitively like every other surface`
  - `filter wiring across surfaces > filters by project identically through Core, the search service, MCP, and both CLI entry points`
- `src/test/mcp-final-summary.test.ts`
  - `MCP final summary > supports finalSummary on task_create and task_view output`
  - `MCP final summary > supports finalSummary set/append/clear on task_edit`
- `src/test/mcp-definition-of-done-defaults.test.ts`
  - `MCP Definition of Done default tools > applies updated project defaults to task creation and supports per-task override behavior`
- `src/test/mcp-tasks.test.ts`
  - `MCP task tools (MVP) > restores an archived task to the board under the same rules as the CLI`
  - `MCP task tools (MVP) > rejects reserved comment markers through task_edit`
- `src/test/linked-record-commit.test.ts`
  - `auto-commit of record files reached through a symbolic link > still commits the file a link points to when a task is edited through MCP`
