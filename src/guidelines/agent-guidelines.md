# Instructions for the usage of Backlog.md CLI Tool

Use the Backlog.md CLI to create, read, and update task, document, and decision records. The CLI preserves IDs, filenames, links, and Git state. Read task files when useful, but make changes through commands.

## Find the active schema

Run `backlog schema --json` first in a project. `task-schema.yml` defines field keys, exact enum values, user handles, sections, and display order. Use `--field key=value` to set a declared field, `--clear-field key` to clear one, `task list --where 'key=value'` to filter, `--sort key[:asc|:desc]` to order, and `--show-fields key1,key2` to add fields to plain list rows. Copy enum values and handles exactly. Shortcut flags such as `-s`, `-a`, and `--priority` use the same field validation.

Use `--plain` for readable task context. Use `--json` for structured data; task JSON is schema version 2 with `fields` and `unknownFields`, and task view also includes `sections` and `other`.

## Choose the relevant workflow

- Creating or splitting tasks: `backlog instructions task-creation`.
- Taking ownership, planning, or implementing: `backlog instructions task-execution`.
- Verifying and finishing work: `backlog instructions task-finalization`.

Read the matching guide before changing a task. These guides contain the current workflow; `backlog task create --help` and `backlog task edit --help` give the available flags.

## Task sections

The built-in schema has `description` (Markdown), `acceptance` (checklist), and `log` (append-only log). A project can declare other sections. Use their IDs in the CLI:

```bash
backlog task create "Task title" -d "Why this matters" --add-item acceptance="First verifiable outcome"
backlog task edit 42 --section description="Revised context"
backlog task edit 42 --append-section description="Implementation plan: verify the API"
backlog task edit 42 --add-item acceptance="Another outcome"
backlog task edit 42 --check acceptance:1
backlog task edit 42 --uncheck acceptance:1
backlog task edit 42 --remove-item acceptance:2
backlog task log 42 "Verified the API and recorded the result" --author @agent
```

`--comment` on task edit also appends to the first configured log section. A log entry has an author, a business date, and a recorded UTC creation time. The author must be a schema user; the schema default user applies when `--author` is omitted. A standalone `---` line cannot appear in a log body. Content outside configured section markers remains available as `Other`.

## 6. Typical Workflow

1. Read task details and confirm status, scope, acceptance criteria, and dependencies with `backlog task view 42 --plain`.
2. Start eligible work: assign yourself & change status using the schema's active status, for example `backlog task edit 42 -s "In Progress" -a @agent`.
3. Research the current code, tests, conventions, and recent changes after activation.
4. Add the current implementation plan to a configured Markdown section. The built-in schema has `description`; a project may add `plan`. For example, `backlog task edit 42 --append-section description="Implementation plan: ..."`.
5. If the plan contains a material product, architecture, or workflow decision, or the user requires review, present it for approval before implementation.
6. Work on the task in focused slices, test each slice, and record useful progress with `backlog task log 42 "..."`.
7. Verify each acceptance item before checking it with `backlog task edit 42 --check acceptance:1`. Record the final result in the log, then move the task to the schema's terminal status.

---

## Documents and decisions

Create and update documentation through the CLI. Document paths are relative to `backlog/docs/`; absolute paths and `..` traversal are rejected.

`backlog doc archive doc-1` moves the document to `backlog/archive/docs/`. Its ID stays reserved; it stays viewable and read-only. Tasks and drafts whose documentation names the file are printed, not changed. `backlog doc restore doc-1` brings it back. To remove it, archive first, then `backlog doc delete doc-1`; delete asks no question and releases the ID. Tasks and drafts whose documentation names the file are printed, not changed.

`backlog decision archive decision-1` moves a decision to `backlog/archive/decisions/`. Its ID stays reserved and the record becomes read-only. `backlog decision restore decision-1` brings it back. `backlog decision delete decision-1` removes an archived decision without a question and releases the ID.

## Shell input

### Multi-line Input

Use repeatable `--append-section` values for separate paragraphs or pass real newlines inside a quoted argument. These forms are safe in constrained agent shells. In some sandboxes, tree-sitter rejects ANSI-C strings and command substitution; see issue #595. If your shell allows them, `$'Line 1\nLine 2'` is a shorthand, but use the safe forms first.

### Literal Backticks in CLI Task Text

Use single-quoted CLI arguments for text containing literal backticks:

```bash
backlog task create 'Document `backlog init` setup' --add-item acceptance='Mention `backlog init --defaults` literally'
```

Backlog.md cannot recover the original text after the shell has already executed it. In shells where single quotes are unsuitable, escape each backtick before running the command.
