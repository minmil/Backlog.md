# Install the fork

After a fork release is published, download the standalone executable for your computer from the fork's GitHub Releases page:

| Computer | Release asset |
| --- | --- |
| Windows x64 | `backlog-bun-windows-x64.exe` |
| Windows ARM64 | `backlog-bun-windows-arm64.exe` |
| Linux x64 / ARM64 | `backlog-bun-linux-x64` / `backlog-bun-linux-arm64` |
| macOS Intel / Apple silicon | `backlog-bun-darwin-x64` / `backlog-bun-darwin-arm64` |

Rename the download to `backlog.exe` on Windows or `backlog` on Linux/macOS. On Linux/macOS, run `chmod +x backlog` after downloading it. Put the executable on your `PATH` or in the directory where you want to run it. The executable contains its runtime, so the computer using it needs no Node.js or Bun installation.

Run `backlog --version` to check the download. In a new data repository, run `backlog init` to create the editable `backlog/task-schema.yml` boilerplate and the other Backlog data folders. Existing projects without a schema file use the built-in default schema. A legacy `backlog/fields.yml` is rejected; migrate its definitions into `backlog/task-schema.yml` and remove the old file.

To build from source instead, install Bun, run `bun install --frozen-lockfile`, then `bun run build`. The output is `dist/backlog` (or `dist/backlog.exe` on Windows).
