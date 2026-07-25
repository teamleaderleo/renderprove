# Renderprove

**Browser evidence for software projects and coding agents.**

Renderprove starts a trusted local project or connects to an existing deployment, opens declared routes in Chromium, and writes a versioned receipt containing screenshots, hashes, page facts, navigation results, and browser diagnostics.

```text
SmolRunner runs it.
Renderprove sees and verifies it.
Stensibly records what happened.
```

Renderprove is early-stage software. It focuses on one auditable CLI, receipt contract, and bounded agent interface rather than a general browser-agent language.

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

## Self-hosted renderer probe

A trusted Linux checkout can build a pinned Playwright worker image and run the fixture review inside a disposable rootless Podman container:

```bash
npm ci --ignore-scripts
npm run probe:podman
```

The probe disables outbound networking, applies CPU, memory, PID, capability, and temporary-filesystem limits, records Chromium, OS, architecture, Node, locale, timezone, image, and font identities, and writes evidence beneath `tests/fixtures/site/.renderprove-probe`.

The initial path is intended for the existing Lima Ubuntu lab VM. SmolRunner remains the eventual owner of runner lifecycle and disposable execution; Renderprove owns the browser review and receipt. See [self-hosted renderer probe](docs/SELF_HOSTED_PROBE.md).

## Local MCP

A local coding agent can call the same implementation through stdio:

```bash
renderprove-mcp --root /Users/you/Projects
```

The MCP server exposes only:

- `inspect_project`
- `review_project`

The operator chooses the root when the process starts. Tool arguments may only select real project and manifest paths beneath it. Responses omit runtime commands, environment values, raw logs, stack traces, and absolute worker paths. Reviews remain headless and return the existing sanitized receipt rather than raw Chrome control.

See [local stdio MCP](docs/MCP.md) for client configuration and the full trust boundary.

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

`target.baseUrl` is an origin, without a path, query, fragment, or embedded credentials. Route and readiness paths stay on that origin, and a main-frame redirect to another origin fails the review before a screenshot is captured.

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

- local and deployed-origin review modes
- shell-free process startup and bounded logs
- desktop, mobile, tablet, and custom viewports
- collision-resistant artifact names and safe output paths
- strict versioned JSON manifests and receipts
- Playwright Chromium receipts
- bounded local stdio MCP tools
- a pinned self-hosted Podman renderer probe for trusted revisions
- locked core, package, executable, MCP, and browser CI

Planned after this contract proves useful:

- interaction steps with a deliberately small vocabulary
- baseline comparison and visual-difference evidence
- authenticated remote HTTP MCP
- Stensibly artifact and work-item adapters
- SmolRunner leased-preview execution
- WebKit, Firefox, and native simulator workers

## Security

Renderprove executes project commands and drives browsers. Read [SECURITY.md](SECURITY.md) before attaching it to a self-hosted runner or MCP client.

## License

Apache-2.0.
