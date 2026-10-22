# Custom fields acceptance — 2026-10-22

Tested the fork's source CLI in `/tmp/cf-accept` with the `fields.yml` from the plan, statuses `Not Started, In Progress, Blocked, Done`, and nine tasks created through `backlog task create`. Relative dates used `BACKLOG_CUSTOM_FIELDS_TODAY=2026-10-22`; `today` is otherwise the machine's local calendar day.

| ID | Status | Key fields |
| --- | --- | --- |
| TASK-1 | In Progress | All eight fields set; `side=them`, `tech_action=Testing`, `prod_date=2026-10-24`, `client_facing=true`, assignee `@someone` |
| TASK-2 | In Progress | `side=us`, `tech_action=Testing`, `prod_date=2026-10-25` |
| TASK-3 | Blocked | `release_item=true`, UAT unset, `prod_date=2026-10-22` |
| TASK-4 | In Progress | `tech_action=Awaiting Client`, `client_facing=true`, assignee `@someone` |
| TASK-5 | Not Started | `tech_action=Awaiting Internal` |
| TASK-6 | Not Started | `tech_action=Pending Triage` |
| TASK-7 | Done | `release_item=true`, `uat_date=2026-10-28`, `prod_date=2026-10-30` |
| TASK-8 | Done | `client_facing=true`, assignee `@other` |
| TASK-9 | Not Started | `prod_date=2026-10-27` |

## Query results

| Command | Result |
| --- | --- |
| `task list --where side=them --where 'status!=Done'` | Exit 1: `--where is for custom fields only`; directs use of built-in flags |
| `task list -s 'In Progress' --where tech_action=Testing --json` | TASK-1, TASK-2 |
| `task list --where 'prod_date>=today' --where 'prod_date<=+7d' --sort prod_date --json` | TASK-3, TASK-1, TASK-2, TASK-9 |
| `task list --where release_item=true --where 'uat_date=' --json` | TASK-3 |
| `task list --where client_facing=yes -a @someone --json` | TASK-1, TASK-4 |
| `task list --where 'tech_action=Awaiting Client|Awaiting Internal' --json` | TASK-4, TASK-5 |

The JSON commands above were piped to `jq -r '.tasks | map(.id) | join(", ")'` to compare the exact ID order.

## Mutations and preservation

- `task edit TASK-6 --field tech_action=configuring` stored `tech_action: Configuring`.
- `task edit TASK-6 --field tech_action=Nonsense` exited 1, listed all seven allowed values, and printed `No changes were applied.` The SHA-256 of the task file remained `457a88e80cc339c98c5e4bf198553040c73417ce66a136cf959ed0bd8ee151ab`.
- After committing the nine created tasks as a scratch baseline, `task edit TASK-1 -s Done` produced a Git diff containing only `status: In Progress` → `status: Done` and one added `updated_date` line. Every custom field line was unchanged.

The scratch project is local and disposable. No client data was used.
