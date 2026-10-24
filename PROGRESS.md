# Schema-driven tracker progress

## Task 1 — UI and code audit

Mapped the current task field and body-section usage across the web UI, server, CLI, TUI and MCP in `AUDIT.md`. Captured the current browser layout from a ten-task sample in light and dark mode, including scrolled task-detail views, under `docs/screenshots/before/`. The capture script is retained for reproducibility. No application behavior changed.

Owner decisions: use every actually persisted serializer key as core, including `subtasks` and `onStatusChange`; keep computed `branch` read-only through the canonical field access layer; retain the `Ordinal` list column and show it read-only in detail; allow an empty value list for optional core `project`, with schema boilerplate showing how to fill it. No TUI or MCP behavior changed in Task 1.

Verification: `bun run check`, `bun run check:types`, and `bun run build` passed. `bun test --timeout=10000` matched the prior custom-fields baseline: 3,609 passed, 13 skipped, 19 known failures across 3,641 tests. The first run with Bun's default five-second timeout added two timeouts in tests that deliberately sleep six seconds; the recorded baseline also uses `--timeout=10000`. No tests were deleted.
