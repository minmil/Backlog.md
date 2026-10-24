## Task Finalization Guide

Use this guide when implementation is complete and ready for review.

1. Read the task with `backlog task view {{TASK_ID:123}} --plain`. Identify evidence for every acceptance criterion and item in any additional configured checklist.
2. Run relevant tests and checks. For UI or interactive work, exercise the behavior through a browser, DOM script, test runner, or documented manual interaction. Code presence, grep output, and implementation intent are not verification evidence.
3. Check only proven items with `backlog task edit {{TASK_ID:123}} --check acceptance:1`. Use the configured section ID for other checklists. Resolve failures before finishing.
4. Confirm the recorded plan matches the final solution and required documentation/configuration updates are complete. Record useful decisions and validation results with `backlog task log {{TASK_ID:123}} "..."`; `--comment` on task edit is an alias for the first log section.
5. Add a concise log entry explaining what changed, why, verification results, and relevant risks or follow-ups. If the project schema has a dedicated summary section, write it with `--section id=text`. Complete any required user review before marking work finished.
6. Mark verified work Done, or the configured final status: `backlog task edit {{TASK_ID:123}} -s "<terminal status>"`. Check accepted statuses with `backlog task edit --help`.

### Task Lifecycle

Leave finished tasks on the board until periodic cleanup. Archive (`backlog task archive {{TASK_ID:123}}`) then moves them off the board while keeping their ID, record, and dependency links.

Archive also takes canceled, duplicate, or invalid work off the board. Archived tasks are read-only, so finish the task log and any configured summary section before archiving. To change an archived task or work on it again, bring it back to the board with `backlog task restore {{TASK_ID:123}}`; it keeps its ID and status.

To remove a task for good, archive it and then delete it with `backlog task delete {{TASK_ID:123}}`. Delete releases the ID once no other branch or worktree still holds the task, and removes the links other tasks and drafts hold to the task, so use it only for work that should leave no record.

### Follow-up Work

Do not create or start follow-up tasks without user approval. For subtasks, verify each separately and finish the parent only when all are complete, unless instructed otherwise. Continue to the next subtask only when the user already assigned the full series; otherwise ask first.
