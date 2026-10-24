---
id: BACK-788
title: Build task schema loader and validator
status: In Progress
assignee:
  - '@codex'
created_date: '2026-10-24T06:59:00Z'
updated_date: '2026-10-24T06:59:00Z'
labels: []
dependencies: []
type: feature
ordinal: 398000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the approved task-schema.yml contract, default and example schemas, initialization, moved config keys, and schema CLI commands.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Schema loader validates users, core fields, field types, translations, UI areas and defaults
- [ ] #2 Initialization writes the default schema and rejects missing or invalid schemas
- [ ] #3 Moved config keys and fields.yml fail with clear messages; schema CLI commands work
- [ ] #4 Checks, tests and build show no new failures versus baseline
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 bun run check:types passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [ ] #3 bun test (or scoped test) passes
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Define the YAML schema types and validator around the serializer’s persisted keys. Ship default and example YAML. Wire initialization and startup validation. Remove moved config keys and fields.yml loading. Add schema CLI commands and focused validation tests. Run checks and compare full suite with the recorded baseline.
<!-- SECTION:PLAN:END -->
