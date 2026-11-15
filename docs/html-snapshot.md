# Standalone HTML snapshot

From a Backlog.md task repository, run:

```sh
backlog export html --output ./backlog-snapshot.html
```

The live browser also has **Export HTML** in its header. Clicking it downloads a fresh `backlog-snapshot.html` from the current local task files; it does not write to the repository. The command-line export lets you choose a destination and use `--force` to replace a previous file.

Open the generated file directly in a current Chromium browser, or place it in a shared drive for colleagues to open. The file runs the same React layout, sidebar, board, task list, and task form as the live browser. The offline JavaScript answers the UI's task reads and writes from embedded data. The live header's **Export HTML** control becomes **Save changes**. No Backlog.md server, Git installation, CDN, or internet connection is needed on the viewer's machine.

The export reads the **current local working copy**, including untracked task files. It embeds non-archived tasks, the configured schema, task-related settings, and active milestone metadata. Archived tasks and tasks that exist only on other Git branches are excluded. Documents and decisions are not exported; their sidebar pages start empty in the offline copy. Export again to publish changes from the main backlog; the file never updates itself from the repository.

The file includes the generation time, project name, task count, and snapshot format version. Version 2 includes only task fields and sections declared by the task schema, plus standard task metadata needed for display. It excludes file paths, undeclared YAML fields, callback commands, Git settings, authentication configuration, and other repository files. It does not embed linked files or remote Markdown images. Mermaid source remains a code block in the snapshot. For very long dependency chains, the detail response limits the graph to nearby tasks to keep the modal responsive.

**Anyone with access to the HTML file can read its embedded task data.** Review the task content and sharing permissions before distributing it. The export is a publication artifact, not an access control boundary.

The snapshot runtime uses in-memory data and a strict Content Security Policy that blocks network connections and external assets. The task form, creation, status changes, drag-and-drop moves, archive, cleanup, drafts, milestone controls, and settings write to the embedded working data. **Save changes** downloads a new self-contained `backlog-reviewed.html` that opens with those changes. Original exported tasks remain embedded alongside proposed task values and edit times for a future importer. The downloaded copy never changes the main backlog; direct import is a later phase. The browser cannot reliably overwrite the HTML file it opened, so keep the downloaded copy.

Automated tests generate synthetic 100, 500, and 1,000 task repositories and execute the embedded viewer in a DOM environment with a `file://` URL. The 100- and 500-task checks exercise the live layout, task links, list, form edit, and downloaded-copy round trip; the 1,000-task check verifies startup. They also check that no network request or WebSocket starts and that script-like task text cannot execute. The connected browser tool in this environment disallows direct `file://` navigation, so a real Chromium `file://` run was unavailable here. DOM tests cannot establish actual browser paint or click latency.
