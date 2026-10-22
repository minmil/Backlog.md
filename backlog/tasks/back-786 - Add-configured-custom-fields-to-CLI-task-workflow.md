---
id: BACK-786
title: Add configured custom fields to CLI task workflow
status: Done
assignee:
  - '@codex'
created_date: '2026-10-22T10:22:00Z'
updated_date: '2026-10-22T11:34:00Z'
labels: []
dependencies: []
type: feature
ordinal: 396000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Client operations work needs typed, filterable fields while keeping Markdown tasks readable and preserving unrelated metadata.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Schema validates declared bool, date, enum, and text fields and task files round-trip them
- [x] #2 CLI create, edit, list, view, and fields commands support custom fields with deterministic validation
- [x] #3 JSON output includes customFields without changing schemaVersion
- [x] #4 Focused tests and acceptance scenario cover filters, sorting, and preservation
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bun run check:types passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Implement the attached custom-fields plan in small verified slices, then build the fork and run the acceptance scenario.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented typed custom fields across schema validation, task parsing and serialization, CLI filtering and sorting, JSON output, instructions, and acceptance coverage. Focused tests pass; the full suite has the same 19 baseline failures.
<!-- SECTION:FINAL_SUMMARY:END -->
