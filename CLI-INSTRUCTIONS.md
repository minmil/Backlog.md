# CLI Reference

Full command reference for Backlog.md. For getting started, see [README.md](README.md).

All examples use the `backlog` command, available after installing the `backlog.md` package globally (`npm i -g backlog.md`) or as a project dependency. For one-off runs without installing, use the full package name — `npx backlog.md <command>`, e.g. `npx backlog.md board`; without an install, `npx backlog` resolves to an unrelated third-party npm package, not this tool.

## Project Setup

### Task schema

`backlog init` writes editable `<backlog-dir>/task-schema.yml` boilerplate. A project without that file uses the same built-in schema through the field registry. Run `backlog schema` or `backlog schema --json` to inspect fields, users, sections, and display settings. `fields.yml` is obsolete; a leftover file causes a startup error pointing to `task-schema.yml`.

Use repeatable `--field key=value` on task creation and edit, and `--clear-field key` on edit. Built-in shortcut flags use the same registry validation. `task list --where <expr>` filters any declared field; repeat it to combine conditions with AND. Supported operators are `=` and `!=` for all types and `<`, `<=`, `>`, `>=` for dates and datetimes. `key=` means unset, `key!=` means set, and `key=a|b` accepts either value. Date expressions accept `today`, `+Nd`, and `-Nd`, resolved using the machine's local time zone. Sort fields with `--sort key[:asc|:desc]`; unset values sort last. `task list --plain --show-fields k1,k2` appends selected values.

| Action      | Example                                              |
|-------------|------------------------------------------------------|
| Initialize project | `backlog init [project-name]` (creates backlog structure with a minimal interactive flow) |
| Re-initialize | `backlog init` (preserves existing config, allows updates) |
| Advanced settings wizard | `backlog config` (no args) — launches the full interactive configuration flow |

`backlog init` keeps first-run setup focused on the essentials:
- **Project name** – identifier for your backlog (defaults to the current directory on re-run).
- **Backlog folder** – choose `backlog/`, `.backlog/`, or a custom project-relative path.
- **Config location** – for built-in folders, choose folder-local `config.yml` or root `backlog.config.yml`; custom paths use root `backlog.config.yml`.
- **Integration choice** – decide whether your AI tools use **CLI instructions** (recommended), the optional **MCP connector**, or no AI setup.
- **Instruction files (CLI path)** – the CLI setup writes a short nudge to AGENTS.md by default in non-interactive setup. `--agent-instructions cursor` also selects AGENTS.md, and the interactive CLI and Web setup identify Cursor under that shared target. Existing user-managed `.cursor/rules` files may coexist; Backlog.md does not migrate or remove them, and repeated initialization preserves non-Backlog content in AGENTS.md.
- **Advanced settings prompt** – default answer "No" finishes init immediately; choosing "Yes" jumps straight into the advanced wizard documented in [ADVANCED-CONFIG.md](ADVANCED-CONFIG.md).

Field values, users, and checklist sections are edited in `task-schema.yml`; the advanced wizard handles the remaining `config.yml` settings.

You can rerun the wizard anytime with `backlog config`. All existing CLI flags (for example `--defaults`, `--agent-instructions`) continue to provide fully non-interactive setups, and init also supports `--backlog-dir <path>` plus `--config-location <folder|root>` for scripted configuration.

Humans and agents can run `backlog instructions` for workflow guides and `backlog instructions overview` for the overview.

## Documentation

- Document IDs are global across all subdirectories under `backlog/docs`. You can organize files in nested folders (e.g., `backlog/docs/guides/`), and `backlog doc list` and `backlog doc view <id>` work across the entire tree.
- Use `backlog doc create "New Guide" -p guides` to create a document in a docs subdirectory. The created output includes the persisted docs-relative file path, such as `backlog/docs/guides/doc-1 - New-Guide.md`.
- Use `backlog doc update doc-1 --content "Updated markdown"` to update document content. Add `--title`, `-t/--type`, `--tags`, or `-p/--path` to update metadata or move the document while preserving omitted fields.
- Use `backlog doc search "query"` for scoped document search with plain text output that includes document IDs and follow-up `backlog doc view <docId>` commands. Use `--limit <number>` to cap results.
- Use `backlog doc archive doc-1` to archive a document you no longer need. Its file moves unchanged to the same relative path under `backlog/archive/docs/`, and its ID stays reserved, so no new document receives it. An archived document leaves `backlog doc list` and search, stays viewable with `backlog doc view <docId>`, and is read-only: `backlog doc update` on it fails until it is restored. Archiving changes no task. The command prints the tasks and drafts whose documentation list names the moved file, so you can update them.
- Use `backlog doc restore doc-1` to bring an archived document back. Its file moves unchanged to the same relative path under `backlog/docs/`, and it keeps its ID and can be updated again. A file already at that path is never replaced.
- Removing a document takes two steps: `backlog doc archive doc-1`, then `backlog doc delete doc-1`. Delete works only on an archived document and asks no question. It removes the file from `backlog/archive/docs/` (a file that is a symbolic link is removed as a link) and releases the ID once no other file and no committed file on any branch uses the number. Delete changes no task: it prints the tasks and drafts whose documentation list names the removed file, by its archive path or by the path it had before it was archived.
- Document paths are always relative to the docs directory. Absolute paths and traversal segments such as `..` are rejected.

## Task Management

| Action | Example |
|--------|---------|
| Create task | `backlog task create "Add OAuth System"` |
| Set description | `backlog task create "Feature" -d "Why this matters"` |
| Set a declared field | `backlog task create "Feature" --field priority=high` |
| Set multiple values | `backlog task edit 7 --field labels=auth,backend` |
| Clear a field | `backlog task edit 7 --clear-field due_date` |
| Add acceptance criteria | `backlog task create "Feature" --add-item acceptance="First outcome" --add-item acceptance="Second outcome"` |
| Replace Markdown section | `backlog task edit 7 --section description="Revised context"` |
| Append Markdown section | `backlog task edit 7 --append-section description="Implementation plan: ..."` |
| Check checklist item | `backlog task edit 7 --check acceptance:1` |
| Uncheck checklist item | `backlog task edit 7 --uncheck acceptance:1` |
| Remove checklist item | `backlog task edit 7 --remove-item acceptance:2` |
| Add log entry | `backlog task log 7 "Verified the behavior" --author @sara` |
| Add log entry on edit | `backlog task edit 7 --comment "Question for review" --comment-author @sara` |
| Create with dependencies | `backlog task create "Feature" --dep task-1,task-2` |
| Create with references | `backlog task create "Feature" --ref https://docs.example.com --ref src/api.ts` |
| Create subtask | `backlog task create -p 14 "Add Login with Google"` |
| List filtered tasks | `backlog task list --where priority=high --search "login" --plain` |
| List in windows | `backlog task list --max-count 20 --skip 20 --plain` |
| List as JSON | `backlog task list --json` |
| Watch as JSON | `backlog task list --json --watch` |
| View detail | `backlog task view 7 --plain` |
| View as JSON | `backlog task view 7 --json` |
| Replace documentation | `backlog task edit 7 --doc docs/spec.md --doc docs/api.md` |
| Add documentation | `backlog task edit 7 --add-doc docs/spec.md` |
| Remove documentation | `backlog task edit 7 --remove-doc docs/spec.md` |
| Clear documentation | `backlog task edit 7 --clear-docs` |
| Archive | `backlog task archive 7` |
| Restore | `backlog task restore 7` |
| Delete | `backlog task delete 7` |

The built-in schema has `description` (Markdown), `acceptance` (checklist), and `log` (append-only log). Use `backlog schema` to discover additional sections and users. Empty sections are omitted from Markdown files but remain available in task view. Content outside configured markers appears under `Other` and is preserved through edits. Checklist removal renumbers remaining items. Log entries have an author, business date, and recorded UTC creation time; standalone `---` lines are reserved.

Mark finished work Done (or the configured final status). During periodic cleanup, Archive moves it off the board; Archive also takes canceled, duplicate, or invalid work off the board at any time. An archived task keeps its ID, its record, and every dependency and reference to it. It stays readable with `backlog task view`, where its status line ends in `(archived)`, and it is read-only. A dependency on an archived task counts as satisfied only when that task is in the final status.

`backlog task restore` moves an archived task back to the board with the same ID and the status it had. Archived tasks cannot be edited: `backlog task edit` on one fails and names the restore command, so restore the task first.

Deleting a task takes two steps: archive it, then run `backlog task delete`. Delete permanently removes the archived task and releases its ID once no other branch or worktree still holds the task, so a later task can receive it. It removes the dependencies and references other tasks and drafts hold to the deleted task and prints the tasks and drafts it changed. It asks no question, because archiving is the confirming step. A task that is not archived is not deleted, and neither is a task whose subtasks still exist, as tasks or as drafts.

Projects that still hold tasks in a `completed` folder keep working: those tasks are read as archived tasks. `backlog doctor` reports them, and `backlog doctor --fix` moves them into `archive/tasks` without changing file names or IDs. If two records claim one task ID, `backlog doctor` reports the pair and `--fix` gives one of them a new ID; a task on the board always keeps its ID.

### Task list order

Without `--sort`, `task list` orders tasks by ordinal, then priority, then ID: tasks that have an ordinal come first, lowest ordinal first, and priorities rank in the configured order. `--sort priority`, `--sort id`, and `--sort ordinal` order by that field and then by ID. Plain output groups the ordered tasks by status in the configured status order, except that `--sort priority` prints one flat list; `--json` returns the ordered tasks as one flat array. The interactive list shows the same tasks in the same order and status groups as `--plain` for the same options, and MCP `task_list`, which has no sort option, uses the order without `--sort`.

### Paging long lists

`task list`, `search`, `draft list`, `milestone list`, `doc list`, `doc search`, and `decision list` print every match by default. `--max-count <n>` prints at most `n` items and `--skip <n>` leaves out the first `n`, as in `git log`. Both apply after filtering, sorting, and `--limit`. `task list` takes the window from the sorted list, so `--plain` and `--json` select the same tasks; plain output then groups only those tasks by status, as it does for `--limit`, unless `--sort priority` prints one flat list. The other lists take the window in the order their output prints: plain `search` prints tasks, then documents, then decisions, and `milestone list` prints active milestones before completed ones. Each list has a stable order: tasks, drafts, and decisions break ties by ID, documents sort by title and then path, search results by score and then corpus order, and milestones follow their files and then the tasks that name them. So consecutive windows of an unchanged backlog neither overlap nor leave items out. With `--json`, `search` windows its results in relevance order, so read all windows of a search in one output mode. The options print text instead of opening an interactive view.

Output cut by a window ends with the shown range, the total, and the command that prints the following items:

```text
Showing 21-40 of 57 items. Next: backlog task list --status 'To Do' --max-count 20 --skip 40
```

The last window has no `Next:` part, and a `--skip` past the end prints only `Showing 0 of 57 items.` Output that is not cut has no footer. `--count` prints only the number of items the same command would list, as `grep --count` does; it cannot be combined with `--json`. There are no short forms because `-m` already means `--milestone`. `--limit` keeps its behavior: it silently shortens the list before any window applies.

Log sections are append-only. Use `backlog task log <id> "text"` for progress, review questions, and final results; `--comment` on task edit is an alias for the first log section. Authors come from the schema users block. A standalone `---` line is reserved as a log delimiter.

Task and milestone due dates are calendar days stored as `YYYY-MM-DD`. Use a plain date such as `2026-08-10`; a due date carries no time and no timezone.

### Stable JSON output

Use `--json` for integrations. Task shapes use `schemaVersion: 2`:

| Command | Envelope |
|---------|----------|
| `task list --json` | `{ "schemaVersion": 2, "kind": "task-list", "tasks": [...] }` |
| `task view <id> --json` | `{ "schemaVersion": 2, "kind": "task-view", "task": {...} }` |
| `draft list --json` | `{ "schemaVersion": 2, "kind": "draft-list", "drafts": [...] }` |
| `draft view <id> --json` | `{ "schemaVersion": 2, "kind": "draft-view", "draft": {...} }` |
| `search [query] --json` | `{ "schemaVersion": 2, "kind": "search", "results": [...] }` |
| `schema --json` | `{ "schemaVersion": 2, "kind": "schema", ... }` |

A compact task has `id`, `title`, `fields`, and `unknownFields`. `fields` contains every schema field with a value, including core fields, keyed by its frontmatter name. `unknownFields` preserves stored keys absent from the active schema. List, draft list, and search task entries use this compact shape. Task and draft view add a project-relative `path`, `sections`, and `other`. Markdown sections are strings; checklists are `[{index, text, checked}]`; log sections are `[{author, date, createdAt, auto?, body}]`. `other` is the preserved Markdown outside configured section markers. Field values are not duplicated as top-level properties.

For example:

```bash
backlog task list --json | jq '.tasks[] | [.id, .fields.status]'
backlog task view BACK-7 --json | jq '.task.sections.acceptance'
backlog search "authentication" --json | jq '.results[] | [.type, .data.id]'
```

`backlog task list --json --watch` first emits the complete matching list, then a full replacement whenever the result changes. Each response is a pretty-printed JSON document followed by a newline. Read successive JSON values; do not parse the whole stream as one document. `--watch` requires `--json`; `--json` and `--plain` are mutually exclusive. Explicit JSON mode is noninteractive.

When `--max-count` or `--skip` cuts a list or search result, its envelope adds `total` (count before the window) and `nextSkip` (next window offset or `null`). An uncut result has neither field. Document and decision JSON retain their existing record shapes; `decision list --json` remains schema version 1.

### Multi-line section input

The CLI preserves input literally: a backslash followed by `n` is not converted to a newline. Use repeatable `--append-section id=text` for separate paragraphs, or put real newlines inside one quoted argument. Some agent sandboxes reject ANSI-C strings and command substitution; these safe forms work there. A project can define additional Markdown section IDs in `task-schema.yml`.

### Literal backticks in task text

Use single-quoted CLI arguments for text that contains Markdown backticks. Otherwise a shell may execute them as command substitution before the CLI receives the text:

```bash
backlog task create 'Document `backlog init` setup' --add-item acceptance='Mention `backlog init --defaults` literally'
```

## Milestone Management

Milestones are managed through milestone files. Use CLI commands instead of editing milestone markdown directly so IDs, filenames, task references, and archive state stay consistent.

| Action | Example |
|--------|---------|
| List milestones | `backlog milestone list --plain` |
| List completed milestones too | `backlog milestone list --show-completed --plain` |
| Add milestone | `backlog milestone add "Release 1.0"` |
| Add with description | `backlog milestone add "Beta" --description "Beta scope"` |
| Add with due date | `backlog milestone add "Beta" --due-date 2026-08-10` |
| Rename and update tasks | `backlog milestone rename "Release 1.0" "Release 2.0"` |
| Set due date without renaming | `backlog milestone rename "Release 1.0" "Release 1.0" --due-date 2026-08-10` |
| Clear due date | `backlog milestone rename "Release 1.0" "Release 1.0" --clear-due-date` |
| Rename without task updates | `backlog milestone rename m-1 "Release 2.0" --no-update-tasks` |
| Remove and clear task milestones | `backlog milestone remove "Release 1.0"` |
| Remove and keep task values | `backlog milestone remove "Release 1.0" --task-handling keep` |
| Remove and reassign tasks | `backlog milestone remove "Release 1.0" --task-handling reassign --reassign-to "Release 2.0"` |
| Archive milestone | `backlog milestone archive m-1` |

`milestone remove` task handling modes are `clear` (default), `keep`, and `reassign`. `--reassign-to` is required when using `--task-handling reassign`, and the target must be an active milestone file.

## Search

Find tasks, documents, and decisions across your entire backlog with fuzzy search:

| Action             | Example                                              |
|--------------------|------------------------------------------------------|
| Search tasks       | `backlog search "auth"`                        |
| Filter by status   | `backlog search "api" --status "In Progress"`   |
| Filter by priority | `backlog search "bug" --priority high`        |
| Combine filters    | `backlog search "web" --status "To Do" --priority medium` |
| Plain text output  | `backlog search "feature" --plain` (for scripts/AI) |
| JSON output        | `backlog search "feature" --json` (for structured integrations) |
| Find by modified file | `backlog search --modified-file src/path.ts --plain` |
| Page results       | `backlog search "api" --max-count 20 --skip 20 --plain` |

**Search features:**
- **Fuzzy matching** -- finds "authentication" when searching for "auth"
- **Modified-file lookup** -- tasks can record project-root-relative modified files; find them later with `--modified-file`
- **Interactive filters** -- refine your search in real-time with the TUI
- **Live filtering** -- see results update as you type (no Enter needed)

## Draft Workflow

| Action      | Example                                              |
|-------------|------------------------------------------------------|
| Create draft | `backlog task create "Feature" --draft`             |
| Draft flow  | `backlog draft create "Spike GraphQL"` → `backlog draft promote 3.1` |
| Demote to draft| `backlog task demote <id>` |

## Dependency Management

Manage task dependencies to express execution order:

| Action      | Example                                              |
|-------------|------------------------------------------------------|
| Add dependencies | `backlog task edit 7 --dep task-1 --dep task-2`     |
| Add multiple deps | `backlog task edit 7 --dep task-1,task-5,task-9`    |
| Create with deps | `backlog task create "Feature" --dep task-1,task-2` |
| View dependencies | `backlog task 7` (shows dependencies in task view)  |
| Validate dependencies | Use task commands to automatically validate dependencies |

**Dependency Features:**
- **Automatic validation**: verifies that referenced dependency tasks exist
- **Flexible formats**: Use `task-1`, `1`, or comma-separated lists like `1,2,3`
- **Completion tracking**: See which dependencies are blocking task progress

### Dependency graph in task detail

Task detail shows the whole dependency context around the selected task, under `Dependency Graph`, directly above the description. It is derived and read-only, and it replaces the raw `Dependencies:` ID list in plain output: the graph names the same direct dependencies and resolves their titles, status, and everything behind them.

CLI plain task output uses this layout for create, edit, and view. JSON version 2 stores the direct dependency list in `task.fields.dependencies`.

```text
Dependency Graph:
--------------------------------------------------
Depends on (1 direct, 2 total):
└─ BACK-2 - Parser rewrite [In Progress]
   └─ BACK-1 - Token schema [completed]

Dependents (2 direct, 2 total):
├─ BACK-8 - Migration guide [To Do]
└─ BACK-9 - Release checklist [To Do]
```

- **Edge direction.** A dependency edge points from the task that declares it to the task it depends on, so the task it points at blocks the task it comes from.
- **Direct versus transitive.** `Depends on` lists everything the selected task transitively depends on; `Dependents` lists everything that transitively depends on it. Nesting shows the distance: the outermost entries are direct relationships and everything indented below them is transitive. The heading counts both, as `N direct, M total`.
- **Dependents.** "Dependents" means the tasks this one blocks. It is the reverse of the task's own dependency list, and nothing on it is editable from here; change it on the task that declares it.
- **Visibility.** The graph resolves against exactly what task detail can already see: the current checkout including archived tasks for the CLI, TUI, and MCP, and the configured cross-branch corpus in the browser. An archived task keeps its ID, so a dependency on it keeps resolving; it reads as `[completed]` only when it is in the final status and keeps blocking otherwise.
- **Cycles and repeats.** Every task appears once. A relationship that points back into the branch above it is marked `(cycle)`, and a task already shown elsewhere in the same section is marked `(shown above)` rather than being expanded again.
- **Unresolved identities.** `unknown task ID` means no visible task claims that ID. `ambiguous task ID` means more than one record claims it, so nothing is chosen. Neither is ever treated as satisfied, and the graph never traverses past one, so anything behind it is left out rather than reported as resolved. Diagnose and repair duplicate IDs with `backlog doctor` before trusting a graph that reports one.

## Board Operations

| Action      | Example                                              |
|-------------|------------------------------------------------------|
| Kanban board      | `backlog board` (interactive UI, press 'E' to edit in editor) |
| Export board | `backlog board export [file]` (exports Kanban board to markdown) |
| Export with version | `backlog board export --export-version "v1.0.0"` (includes version in export) |

## Statistics & Overview

| Action      | Example                                              |
|-------------|------------------------------------------------------|
| Project overview | `backlog overview` (interactive TUI showing project statistics) |

## Web Interface

| Action      | Example                                              |
|-------------|------------------------------------------------------|
| Web interface | `backlog browser` (launches the local-machine-only web UI on `127.0.0.1:6420`) |
| Web custom port | `backlog browser --port 8080 --no-open` |

The Web UI listens only on `127.0.0.1`; it is not reachable from other devices on the LAN or VPN.

To keep the Web UI running in the background with auto-start on boot, see [Running Backlog.md as a Service](backlog/docs/doc-003%20-%20Running-Backlog-Browser-as-a-Service.md).

## Documentation

| Action      | Example                                              |
|-------------|------------------------------------------------------|
| Create doc | `backlog doc create "API Guidelines"` |
| Create with path | `backlog doc create "Setup Guide" -p guides/setup` |
| Create with type | `backlog doc create "Architecture" -t guide` |
| Update content | `backlog doc update doc-1 --content "Updated markdown"` |
| Update metadata/path | `backlog doc update doc-1 --title "Setup Handbook" -t guide --tags setup,runbook -p guides` |
| List docs | `backlog doc list` |
| Search docs | `backlog doc search "architecture" --limit 5` |
| View doc | `backlog doc view doc-1` |
| Archive doc | `backlog doc archive doc-1` (move the document to `backlog/archive/docs/`; its ID stays reserved and it becomes read-only) |
| Restore doc | `backlog doc restore doc-1` (move an archived document back to `backlog/docs/` with the same ID) |
| Delete doc | `backlog doc delete doc-1` (archived documents only; no prompt; removes the file and releases the ID) |

Document and decision updates automatically keep unknown top-level YAML frontmatter keys, including their written values and comments. No configuration is needed. If preserving a YAML reference would break it or prevent applying a change to a Backlog-owned field, the save fails with a clear error and leaves the file and path unchanged. For example, `owner: *name` refers to the value marked with `&name`; edit that reference or its anchor in the file before trying again.

## Decisions

| Action      | Example                                              |
|-------------|------------------------------------------------------|
| Create decision | `backlog decision create "Use PostgreSQL for primary database"` |
| Create with status | `backlog decision create "Migrate to TypeScript" -s proposed` |
| Change status | `backlog decision edit decision-1 -s superseded` (the status is free-form; the rest of the decision file stays as it is) |
| Archive decision | `backlog decision archive decision-1` (move the decision to `backlog/archive/decisions/`; its ID stays reserved and it becomes read-only) |
| Restore decision | `backlog decision restore decision-1` (move an archived decision back to `backlog/decisions/` with the same ID) |
| Delete decision | `backlog decision delete decision-1` (archived decisions only; no prompt; removes the file and releases the ID) |

- Use `backlog decision archive decision-1` to archive a decision that is no longer wanted. Its file moves unchanged, under the same name, to `backlog/archive/decisions/`, and its ID stays reserved, so no new decision receives it. An archived decision leaves `backlog decision list` and search and is read-only until it is restored. No command prints a single decision yet, so an archived decision is read by restoring it. Archiving changes no task: the command prints the tasks and drafts whose documentation list names the moved file.
- Use `backlog decision restore decision-1` to bring an archived decision back to `backlog/decisions/` with the same ID. A file of that name already there is never replaced.
- Removing a decision takes two steps: `backlog decision archive decision-1`, then `backlog decision delete decision-1`. Delete works only on an archived decision and asks no question. It removes the file from `backlog/archive/decisions/` (a file that is a symbolic link is removed as a link) and releases the ID once no other file and no committed file on any branch uses the number. Delete changes no task: it prints the tasks and drafts whose documentation list names the removed file, by its archive path or by the path it had before it was archived.

## Agent Instructions

| Action                                          | Example                                              |
|-------------------------------------------------|------------------------------------------------------|
| Open the local CLI documentation entry point | `backlog` |
| List workflow guides | `backlog instructions` |
| Required first read for task workflow | `backlog instructions overview` |
| Read a detailed workflow guide | `backlog instructions task-execution` |
| Update CLI agent instruction files | `backlog agents --update-instructions` (updates CLAUDE.md, AGENTS.md, GEMINI.md, .github/copilot-instructions.md) |

## Maintenance

| Action      | Example                                                                                      |
|-------------|----------------------------------------------------------------------------------------------|
| Cleanup done tasks | `backlog cleanup` (archive old finished tasks to clean up the kanban board; asks for an age, so its input and its output must both be an interactive terminal) |

Full help: `backlog --help`

---

## Sharing & Export

### Board Export

Export your Kanban board to a clean, shareable markdown file:

```bash
# Export to default Backlog.md file
backlog board export

# Export to custom file
backlog board export project-status.md

# Force overwrite existing file
backlog board export --force

# Export to README.md with board markers
backlog board export --readme

# Include a custom version string in the export
backlog board export --export-version "v1.2.3"
backlog board export --readme --export-version "Release 2024.12.1-beta"
```

Perfect for sharing project status, creating reports, or storing snapshots in version control.

---

## Shell Tab Completion

Backlog.md can install tab completion for bash, zsh, fish, and PowerShell.

**Quick Installation:**
```bash
# Auto-detect and install for your current shell
backlog completion install

# Or specify shell explicitly
backlog completion install --shell bash
backlog completion install --shell zsh
backlog completion install --shell fish
backlog completion install --shell pwsh
```

**What you get:**
- Command completion: `backlog <TAB>` → shows all commands
- Dynamic task IDs: `backlog task edit <TAB>` → shows actual task IDs from your backlog
- Smart flags: `--status <TAB>` → shows configured status values
- Context-aware suggestions for priorities, labels, and assignees

Full documentation: See [completions/README.md](completions/README.md) for detailed installation instructions, troubleshooting, and examples.
