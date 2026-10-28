# Schema-driven tracker acceptance — 2026-10-25

Tested the built executable in a fresh filesystem-only project at `/tmp/schema-accept`. Initialization used `backlog init 'Schema Acceptance' --defaults --integration-mode none --no-git`, then replaced its boilerplate `backlog/task-schema.yml` with [`docs/examples/operations-tracker-schema.yml`](docs/examples/operations-tracker-schema.yml). `backlog schema validate` passed before and after the scenario. The example schema has 30 fields, four sections, and two configured users.

## Tasks and field writes

All supplied task fields used repeatable `--field` assignments, including core status, assignee, priority, type, and project. The task title remained the positional create argument.

| ID | Title | Selected fields |
| --- | --- | --- |
| TASK-1 | Client release | In Progress, @owner, Client 1, Change, high, side=us, tech_action=Testing, release_item=true, uat_date=2026-11-04, prod_date=2026-11-10 |
| TASK-2 | Await client | To Do, @colleague, Client 2, Inquiry, side=them, tech_action=Awaiting Client, client_facing=true |
| TASK-3 | Unscheduled release | Done, @owner, Client 1, Incident, tech_action=Released, release_item=true, uat_date unset, prod_date=2026-11-12 |
| DRAFT-1 | Future change | Draft lifecycle status, Change, Client 2, side=us |

The first task was created with `--section description='Prepare the client release'` and `--add-item acceptance='Client approves UAT'`. Creating TASK-1, TASK-2, and TASK-3 wrote automatic log entries for their `track_changes` field `tech_action`.

## Query and sort results

Each command used `backlog task list ... --json`; these results were asserted against the returned task IDs before TASK-1's later edit.

| Flags | Task IDs |
| --- | --- |
| `--where 'side=them'` | TASK-2 |
| `--where 'status!=Done'` | TASK-1, TASK-2 |
| `--where 'raised_date<2026-11-02'` | TASK-1 |
| `--where 'raised_date<=2026-11-02'` | TASK-1, TASK-2 |
| `--where 'prod_date>2026-11-10'` | TASK-3 |
| `--where 'prod_date>=2026-11-10'` | TASK-1, TASK-3 |
| `--where 'uat_date='` (unset) | TASK-2, TASK-3 |
| `--where 'uat_date!='` (set) | TASK-1 |
| `--where 'assignee=@owner'` | TASK-1, TASK-3 |
| `--sort tech_action` (custom enum) | TASK-1, TASK-2, TASK-3 |
| `--sort prod_date` (custom date; missing last) | TASK-1, TASK-3, TASK-2 |

`backlog task list --where 'release_item=true' --show-fields project,uat_date,prod_date --plain` displayed both release tasks and their configured fields.

## Sections, log, and preservation

TASK-1 was edited with `--section description='Release context updated after client review' --check acceptance:1 --field tech_action='Awaiting Internal' --author @owner`. The checklist item became checked, and an automatic log entry recorded `Tech action: Testing → Awaiting Internal`. `backlog task log TASK-1 'Client approval recorded for the release' --author @owner --date 2026-10-20` added a backdated business date; the entry retains its later UTC creation time.

Before those CLI edits, `## Notes` and `Client prefers a Tuesday release.` were hand-added outside schema markers. Both remained in task view's `other` after the edits.

An invalid `task edit TASK-1 --field side=invalid` exited 1 with `allowed values: us, them` and `No changes were applied.` The task file's SHA-256 was identical before and after: `9945323474530841c773626f678ccc50dd4a96b118d39033ba1afed7212411e2`.

For a negative schema validation check, TASK-1's stored `dependencies` was temporarily set to `TASK-999`. `backlog schema validate` exited 1 and reported `dependencies: Task TASK-999 does not exist`. The original file was restored, and validation then passed.

## JSON v2 samples

Task list, view, search, and draft list all returned `schemaVersion: 2`. The representative shapes were:

```json
{"schemaVersion":2,"kind":"task-list","tasks":[{"id":"TASK-1","title":"Client release","fields":{"status":"In Progress","side":"us","tech_action":"Awaiting Internal"},"unknownFields":{}}]}
{"schemaVersion":2,"kind":"task-view","task":{"id":"TASK-1","fields":{"release_item":true},"unknownFields":{},"sections":{"acceptance":[{"index":1,"text":"Client approves UAT","checked":true}],"log":[{"author":"@owner","date":"2026-10-20","body":"Client approval recorded for the release"}]},"other":"...## Notes..."}}
{"schemaVersion":2,"kind":"search","results":[{"type":"task","data":{"id":"TASK-3","fields":{"tech_action":"Released"},"unknownFields":{}}}]}
{"schemaVersion":2,"kind":"draft-list","drafts":[{"id":"DRAFT-1","fields":{"status":"Draft","type":"Change"},"unknownFields":{}}]}
```

The snippets omit additional returned keys and entries for readability. They show the actual envelope and field locations; the complete outputs were inspected during the scenario.

The versioned build reports `1.55.1-cf.2`, and its `schema --json` returns version 2 with the example schema's 30 fields and four sections. The latest full-suite gate before this scenario (Task 12) was **3,337 pass / 46 skip / 19 known baseline fail**. Task 13's closing gate is recorded in [`PROGRESS.md`](PROGRESS.md).
