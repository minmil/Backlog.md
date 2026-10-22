# Install the custom fields fork

This fork builds a standalone `backlog` executable from Bun 1.4.3. Run these commands in the fork checkout on the target machine. The example uses the Linux system CA bundle; on another platform, substitute a trusted PEM bundle.

```sh
CF_CA_DIR=$(mktemp -d)
node scripts/filter-trusted-cas.cjs /etc/ssl/certs/ca-certificates.crt "$CF_CA_DIR"
bun install --cafile "$CF_CA_DIR/ca-bundle.crt" --frozen-lockfile --linker=isolated
BACKLOG_BUILD_VERSION=1.55.1-cf.1 bun run build
./dist/backlog --version
./dist/backlog fields --help
mkdir -p "$HOME/.local/bin"
install -m 755 dist/backlog "$HOME/.local/bin/backlog"
```

Ensure `$HOME/.local/bin` is on `PATH`. Then run `backlog --version` and `backlog fields` inside the tracker repository. The executable reads that repository's `<backlog-dir>/fields.yml`; there is no global schema.

For a machine that already has a filtered CA bundle, skip the first line and pass its path to `bun install --cafile`. See [DEVELOPMENT.md](DEVELOPMENT.md) for the pinned runtime and certificate details.
