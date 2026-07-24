# Renderprove

**Browser evidence for software projects and coding agents.**

Renderprove starts a trusted local project or connects to an existing deployment, opens declared routes in Chromium, and writes a versioned receipt containing screenshots, hashes, page facts, navigation results, and browser diagnostics.

```text
SmolRunner runs it.
Renderprove sees and verifies it.
Stensibly records what happened.
```

Renderprove is early-stage software. The first release focuses on one auditable local CLI and receipt contract rather than a general browser-agent language.

## First review

Requires Node.js 22 or newer.

```bash
npm install
npx playwright install chromium
cp examples/vite.renderprove.json renderprove.json
npx renderprove inspect
npx renderprove review
```

The review exits with `0` when every case passes, `1` when browser evidence violates the declared policy, and `2` for configuration or execution failures.

## Manifest

Renderprove reads `renderprove.json` or `.renderprove.json` from the project root.

```json
{
  "$schema": "https://raw.githubusercontent.com/teamleaderleo/renderprove/main/schema/manifest-v1.schema.json",
  "version": 1,
  "project": "my-vite-app",
  "runtime": {
    "command": ["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", "4173"],
    "port": 4173,
    "readyPath": "/"
  },
  "review": {
    "routes": ["/", "/about"],
    "viewports": ["desktop", "mobile"]
  }
}
```

Commands are arrays and launch without a shell. Local servers bind by policy to loopback through `HOST=127.0.0.1`; project commands remain responsible for respecting that setting or their explicit host arguments.

To inspect an existing deployment instead, replace `runtime` with:

```json
{
  "target": { "baseUrl": "https://example.com" }
}
```

## Evidence

Each route and viewport produces:

- final URL and navigation status
- page title, language, text size, and overflow measurements
- a PNG screenshot and SHA-256 digest
- console errors, uncaught page errors, failed requests, and HTTP error responses
- an explicit pass or fail result based on manifest policy

Receipts are written to `.renderprove/receipt.json` by default. Absolute worker paths and successful-process log contents are excluded from receipts. See [receipt v1](docs/RECEIPT_V1.md).

## Current boundary

Included now:

- local and deployed-URL review modes
- shell-free process startup and bounded logs
- desktop, mobile, tablet, and custom viewports
- collision-resistant artifact names and safe output paths
- strict versioned JSON manifests
- Playwright Chromium receipts
- core and full browser CI

Planned after this contract proves useful:

- interaction steps with a deliberately small vocabulary
- baseline comparison and visual-difference evidence
- local stdio and remote HTTP MCP
- Stensibly artifact and work-item adapters
- SmolRunner leased-preview execution
- WebKit, Firefox, and native simulator workers

## Security

Renderprove executes project commands and drives browsers. Read [SECURITY.md](SECURITY.md) before attaching it to a self-hosted runner or remote MCP endpoint.

## License

Apache-2.0.
