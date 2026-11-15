# Standalone HTML snapshot

From a Backlog.md task repository, run:

```sh
backlog export html --output ./backlog-snapshot.html
```

Open the generated file directly in a current Chromium browser, or place it in a shared drive for colleagues to open. It contains the board, list, search, filters, sorting, task details, configured schema fields and sections, logs, checklists, and links between tasks. It needs no Backlog.md server, Git installation, CDN, or internet connection on the viewer's machine. Use `--force` to replace an existing file.

The export reads the **current local working copy**, including untracked task files. Active tasks appear on the board and list. Archived tasks are embedded for dependency context and can be shown in the list with **Include archive**. Tasks that exist only on other Git branches are excluded. Export again to publish changes; the page never updates itself.

The file includes the generation time, project name, task counts, and snapshot format version. Version 1 explicitly includes only task fields and sections declared by the task schema, plus standard task metadata needed for display. It excludes file paths, undeclared YAML fields, callback commands, Git settings, authentication configuration, and other repository files. It does not embed linked files or remote Markdown images. Mermaid source remains a code block in the snapshot. The dependency view shows direct links so long chains do not produce deep browser trees; each linked task can be opened to continue browsing.

**Anyone with access to the HTML file can read its embedded task data.** Review the task content and sharing permissions before distributing it. The export is a publication artifact, not an access control boundary.

The snapshot runtime uses in-memory data and a strict Content Security Policy that blocks network connections and external assets. The browser UI remains read-only: it does not initialize the live API, watchers, or WebSocket, and it offers no save, archive, drag, or configuration controls.

Automated tests generate synthetic 100, 500, and 1,000 task repositories and execute the embedded viewer in a DOM environment with a `file://` URL. The connected browser tool in this environment disallows direct `file://` navigation, so a real Chromium `file://` run was unavailable here. The DOM tests verify board/list/detail, search, filters, task navigation, custom fields, logs, Japanese text, archive inclusion, disabled editing, no network API calls, and script injection handling; they cannot establish actual browser paint or click latency.
