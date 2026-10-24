---
id: BACK-787
title: Audit schema-driven task UI and code surfaces
status: Done
assignee:
  - '@codex'
created_date: '2026-10-24T06:25:00Z'
updated_date: '2026-10-24T06:59:00Z'
labels: []
dependencies: []
type: feature
ordinal: 397000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The approved schema-driven tracker plan replaces fixed task fields and sections across the CLI, API, and browser. First record the existing display and write paths so default schema values and later UI changes can preserve current behavior.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AUDIT.md maps task field and section reads and writes across web screens, server endpoints, CLI, TUI, and MCP
- [x] #2 The audit records exact current contents of each configurable UI area
- [x] #3 Light and dark baseline screenshots exist for the specified screens using ten sample tasks
- [x] #4 Task checks and build show no new failures versus the recorded baseline
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Inventory task-related reads and writes across web screens, API routes, CLI, TUI, and MCP. 2. Record current field and section placement for schema UI defaults. 3. Capture light and dark screenshots using ten representative tasks. 4. Verify formatting, types, build, and focused tests; record the audit and progress.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Mapped the current web, API, CLI, TUI and MCP task surfaces; captured 22 baseline screenshots and the ten-task sample; verified checks, build and the full 10-second-timeout baseline (3609 pass, 13 skip, 19 known fail). Owner decisions for the schema are recorded in AUDIT.md and PROGRESS.md.
<!-- SECTION:FINAL_SUMMARY:END -->
