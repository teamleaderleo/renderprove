# Renderprove

**Browser evidence for software projects and coding agents.**

Renderprove starts a trusted local project or connects to an existing deployment, opens declared routes in Chromium, and writes a versioned receipt with screenshots, hashes, page/navigation facts, browser diagnostics, and explicit review disposition.

```text
Glaeda runs it.
Renderprove sees and verifies it.
Stensibly records what happened.
```

Renderprove is early-stage software. It favors one auditable CLI, a strict manifest and receipt contract, bounded browser interactions, and bounded agent interfaces over general browser automation or agent reasoning. [Architecture](docs/ARCHITECTURE.md) owns the detailed product and integration boundaries.

## First review

Requires Node.js 22 or newer.

```bash
npm install
npx playwright install chromium
cp examples/vite.renderprove.json renderprove.json
npx renderprove inspect
npx renderprove review
```

`review` exits with `0` when every case passes, `1` when completed browser evidence violates declared policy, and `2` for configuration or execution failures.

A committed, revisioned manifest is authoritative configuration. It selects one declared local process or one existing HTTP origin plus the routes, viewports, and review policy. Local startup is shell-free; local targets are loopback-scoped; route and readiness navigation remains on the declared origin. See [architecture](docs/ARCHITECTURE.md) and the [manifest v1 schema](schema/manifest-v1.schema.json).

## Review evidence

Each route/viewport case can contribute:

- final URL and navigation status;
- page title, language, text size, and overflow facts;
- a PNG screenshot and SHA-256 digest;
- console errors, uncaught page errors, failed requests, and HTTP error responses;
- an explicit pass/fail result from manifest policy.

Receipts default to `.renderprove/receipt.json`. They exclude absolute worker paths and successful-process log contents. The field-level contract lives in [receipt v1](docs/RECEIPT_V1.md).

Deterministic browser evidence remains authoritative for the Renderprove review disposition. Screenshot text, repository source, and model output are untrusted evidence. Optional vision/advisory results are separate, non-authoritative artifacts and cannot revise the browser receipt or review exit code.

## Focused capabilities

### Self-hosted renderer probe

For a trusted Linux checkout, the pinned Podman probe exercises the fixture review in an isolated worker and can repeat fresh containers to test screenshot convergence:

```bash
npm ci --ignore-scripts
npm run probe:podman
npm run probe:repeatability
```

Renderer identity, isolation limits, fingerprints, repeatability receipts, and the Glaeda runner handoff are owned by [the self-hosted probe guide](docs/SELF_HOSTED_PROBE.md).

### Local MCP

A local coding agent can call the same implementation through stdio:

```bash
renderprove-mcp --root /Users/you/Projects
```

The public MCP surface is deliberately small: `inspect_project` and `review_project`. The operator fixes the root at process start; responses use the existing sanitized project/receipt contracts instead of exposing raw Chrome control, commands, environment values, logs, stacks, or host paths. Client setup and root/path controls live in [the MCP guide](docs/MCP.md).

### Bounded interactions

`renderprove/interaction` validates a closed interaction-plan vocabulary for pointer movement/drag, click, fill, select, wait/state checks, and caller-handled captures. Plans carry cancellation and time limits and return privacy-filtered failure information. Arbitrary JavaScript, shell, file transfer, clipboard, unrestricted keyboard input, and raw browser control stay outside the contract.

Interaction plans remain standalone in this release; manifest v1 and receipt v1 are unchanged. See [interaction plans](docs/INTERACTIONS.md) and the [v1 schema](schema/interaction-plan-v1.schema.json).

### Deterministic visual comparison

```bash
npx renderprove compare baseline.png candidate.png
```

`compare` produces model-free PNG difference evidence for equally sized images, including exact changed pixels, perceptual metrics, a heatmap, and a fixed panel artifact. Declared thresholds determine pass/fail; the comparison artifact remains separate from receipt v1. Metric definitions, thresholds, panel/digest rules, PNG limits, and future metric work live in [deterministic visual comparison](docs/VISUAL_COMPARISON.md).

### Sparse screenshot vision

```bash
renderprove vision-check \
  --screenshot .renderprove/desktop/home.png \
  --brief renderprove-vision-brief.txt \
  --dry-run --json
```

`vision-check` builds a bounded provider-neutral request from an explicit PNG, operator brief, and optional matching receipt. It canonicalizes the image, binds an exact request digest, and exposes a privacy-safe preview. Provider-free `vision-advice-v1` normalization remains advisory and cannot change deterministic review status. See [the vision contract](docs/VISION_CHECK.md) and [`schema/`](schema/).

### Optional AI advisory

```bash
npx renderprove advise --dry-run
npx renderprove advise
```

The optional Cloudflare Workers AI path sends a bounded, sanitized source-and-receipt bundle only at explicit operator request. The persisted result declares `authoritative: false`; availability is tracked separately, and model output never changes browser-review status or exit code. Provider setup, egress review, project policy, limits, cache reuse, redaction, and retention guidance live in [optional AI advisory review](docs/AI_ADVISORY.md).

## Manifest sketch

Renderprove reads `renderprove.json` or `.renderprove.json` from the project root. A minimal local-runtime manifest looks like:

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

For a deployed review, use `target.baseUrl` instead of `runtime`. The target is an origin; readiness/routes stay on it, and a cross-origin main-frame redirect fails before screenshot capture. Detailed execution flow and adapter behavior belong to [architecture](docs/ARCHITECTURE.md).

## Current boundary

Included today: local/deployed review, strict versioned manifests/receipts, isolated Chromium cases, bounded logs/output paths, local stdio MCP, trusted self-hosted probe/repeatability evidence, standalone bounded interactions, deterministic PNG comparison, provider-neutral vision request/advice contracts, optional bounded AI advisory, and locked core/browser/worker/agent/advisory CI.

Planned work stays behind explicit new contracts: attaching interaction evidence, receipt v2 visual/baseline references, a reviewed live vision-provider adapter, additional rendered-image metrics, authenticated remote MCP, Stensibly/Glaeda adapters, and additional browser/native workers.

## Security

Renderprove executes repository-declared commands, drives browsers, captures potentially sensitive evidence, and can explicitly transfer sanitized files to an external AI provider. Use trusted revisions and read [SECURITY.md](SECURITY.md) before attaching it to a self-hosted runner, MCP client, or provider account. `SECURITY.md` owns the detailed operator-safety, credential, isolation, retention, and hostile-workspace guidance.

## License

Apache-2.0.
