# Renderprove

**Browser evidence for software projects and coding agents.**

Renderprove starts a trusted local project or connects to an existing deployment, opens declared routes in Chromium, and writes a versioned receipt containing screenshots, hashes, page facts, navigation results, and browser diagnostics.

```text
SmolRunner runs it.
Renderprove sees and verifies it.
Stensibly records what happened.
```

Renderprove is early-stage software. It focuses on one auditable CLI, receipt contract, bounded interaction engine, and bounded agent interface rather than a general browser-agent language.

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

Run five fresh worker containers and require every screenshot digest to converge:

```bash
npm run probe:repeatability
```

The repeatability report records every worker fingerprint, receipt status, case set, and screenshot SHA-256 observation beneath `tests/fixtures/site/.renderprove-repeatability`. It exits with `1` when a receipt fails, the renderer identity changes, a case disappears, or screenshot bytes drift.

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

## Bounded interactions

The public `renderprove/interaction` API validates and runs a deliberately small browser-action vocabulary:

- pointer movement and drag paths using normalized coordinates
- click, fill, select, wait, and wait-for-state
- page or element capture through a caller-supplied evidence handler
- cancellation, time budgets, drag cleanup, and privacy-filtered results

Normalized endpoints remain inside target and viewport pixel bounds. Locator resolution and locator clicking share one deadline. Failed steps expose bounded failure codes without raw browser causes.

It excludes arbitrary JavaScript, shell commands, raw Playwright access, file upload, clipboard access, and unrestricted keyboard control. Interaction plans remain standalone in this release; manifest v1 and receipt v1 stay unchanged.

See [interaction plans](docs/INTERACTIONS.md) and the [interaction-plan v1 schema](schema/interaction-plan-v1.schema.json).

## Deterministic visual comparison

Compare two equally sized PNG screenshots without launching a browser or calling a model:

```bash
npx renderprove compare baseline.png candidate.png
```

The command writes a strict [visual comparison v1](schema/visual-comparison-v1.schema.json) result, a full-resolution Delta-E heatmap, and a fixed-order `reference | candidate | difference` triptych. It records exact changed pixels plus alpha-weighted CIE76 mean, p95, p99, maximum, tail fractions, and alpha error.

```bash
npx renderprove compare baseline.png candidate.png \
  --max-p99-delta-e 1.5 \
  --max-obvious-fraction 0.001 \
  --output .renderprove/visual/home-desktop
```

The result exits with `0` when declared thresholds pass, `1` when the completed comparison fails, and `2` for input or execution failures. The artifact remains separate from receipt v1. See [deterministic visual comparison](docs/VISUAL_COMPARISON.md) for the metric boundary, panel digest, PNG limits, and planned FLIP upgrade.

## Sparse screenshot vision contract

Current main also contains the separate `vision-check` path for screenshot-oriented advisory evidence. It builds one bounded provider-neutral request from an explicit PNG, a short operator brief, and an optional matching Renderprove receipt:

```bash
renderprove vision-check \
  --screenshot .renderprove/desktop/home.png \
  --brief renderprove-vision-brief.txt \
  --receipt .renderprove/receipt.json \
  --dry-run \
  --json
```

The command canonicalizes the image to a bounded metadata-free RGBA PNG, validates the optional receipt against the exact screenshot hash, emits a privacy-safe public preview, and binds the private packet to a deterministic request digest and fixed prompt/canonicalization identities. Screenshot text remains untrusted evidence; model output remains advisory and cannot revise deterministic browser disposition.

The repository also exports strict provider-free `vision-advice-v1` normalization and schemas. That layer validates and normalizes an eventual vision-provider response locally with bounded fields and advisory authority. It performs no provider call by itself. This is already packaged/tested API surface rather than a future placeholder.

See [sparse screenshot advisory contract](docs/VISION_CHECK.md) and the `vision-advice-v1` / `vision-advice-payload-v1` schemas under [`schema/`](schema/).

## Optional Gemma advisory

Cloudflare Workers AI can provide a cheap secondary source-oriented review over the latest receipt and a bounded set of project files:

```bash
npx renderprove advise --dry-run

export CLOUDFLARE_ACCOUNT_ID='your-account-id'
export CLOUDFLARE_API_TOKEN='your-workers-ai-token'
npx renderprove advise
```

The default model is `@cf/google/gemma-4-26b-a4b-it`. A project can declare focused questions, includes, excludes, limits, a per-run Neuron ceiling, and exact-digest cache reuse in `renderprove-advice.json`. Common lockfiles are excluded by default and can be enabled for dependency-focused reviews.

The result is written to `.renderprove/advice.json`, follows [advice v1](schema/advice-v1.schema.json), and always declares `authoritative: false`. `.renderprove/advice-status.json` says whether the optional result is available, skipped, or unavailable. AI output does not change deterministic browser-review status or exit code. Use `--dry-run --json` to inspect the exact sanitized bundle and conservative Neuron estimate before transfer.

See [optional AI advisory review](docs/AI_ADVISORY.md) for the short project policy, CI setup, data-egress guidance, limits, and cache contract.

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
- repeated fresh-container screenshot convergence reports
- standalone bounded interaction-plan validation and execution
- deterministic standalone PNG comparison with exact and perceptual evidence
- provider-neutral bounded `vision-check` request construction and privacy preview
- provider-free strict vision-advice normalization/schema API
- optional bounded Cloudflare Gemma source advisory artifacts with project policy and cache reuse
- locked core, package, executable, MCP, worker, interaction, advice, vision, visual, and browser CI

Planned after this contract proves useful:

- attach interaction results and captures to a new evidence contract
- add baseline identity and visual-comparison references to receipt v2
- connect the provider-neutral vision request/advice contracts to a reviewed live vision provider adapter
- add FLIP as an explicitly versioned rendered-image metric
- authenticated remote HTTP MCP
- Stensibly artifact and work-item adapters
- SmolRunner leased-preview execution
- WebKit, Firefox, and native simulator workers

## Security

Renderprove executes project commands, drives browsers, compares operator-selected screenshots, and can explicitly transfer sanitized files to an external AI provider. Read [SECURITY.md](SECURITY.md) before attaching it to a self-hosted runner, MCP client, or Workers AI account.

## License

Apache-2.0.
