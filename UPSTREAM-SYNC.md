# Upstream sync

Last reviewed upstream baseline: [MrLesk/Backlog.md](https://github.com/MrLesk/Backlog.md) tag `v1.55.1`, commit `603d90af79781da1d13fff37ba7aa51a26a5602c`.

Four upstream fixes were brought into this fork after that baseline:

| Upstream commit | Fork commit | Change |
| --- | --- | --- |
| `f74e0336` | `56ab180f` | Missing document view exits with an error status. |
| `02918cf5` | `80b37091` | Duplicate task ID repair handles filenames near the filesystem limit. |
| `67a4d847` | `d18423a5` | Compact task JSON includes direct dependency IDs. |
| `0e0d2967` | `f56f8e43` | Cleanup previews track selections, and batch archiving avoids repeated scans. |

Review later upstream changes from this baseline, checking for overlap with these four imports before cherry-picking. The imported behavior was adapted where this fork uses schema-driven task fields and JSON v2.
