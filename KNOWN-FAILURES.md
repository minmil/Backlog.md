# Known failures during the schema migration

This ledger tracks failures beyond the 19 failures recorded in the pre-schema baseline at commit `c645ca5`. A task gate permits only those baseline failures and entries explicitly assigned below. Each task removes its entries before its closure commit. By the end of Task 10, this ledger must contain no active failures.

## Active failures

The current full-suite run is still in progress. Entries will be added from its final file and test names, with an owning Task 4, 5, 9, or 10 and a one-line reason.

## TUI/MCP exclusions

The TUI and MCP are not upgraded: owner decision 2026-10-24. Failing TUI/MCP tests are retained and marked skipped with the reason `TUI/MCP not upgraded – owner decision 2026-10-24`. Their exact file and test names will be recorded after the full-suite triage.
