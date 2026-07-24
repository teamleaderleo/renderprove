# Architecture

## Product boundary

Renderprove owns project-aware inspection. It does not own durable coordination, general CI scheduling, production deployment, or arbitrary agent reasoning.

- **Renderprove:** manifests, project startup, browser review, evidence, receipts.
- **SmolRunner:** trusted workers, bounded execution, leased workspaces and previews.
- **Stensibly:** requests, claims, handoffs, events, and artifact references.
- **Playwright:** browser implementation behind Renderprove's narrower contract.

Every integration is optional. The CLI and receipt format remain useful without either neighboring project.

## Execution flow

1. Load and strictly validate a revisioned project manifest.
2. Start exactly one declared local process or use one declared HTTP target.
3. Wait for a loopback readiness endpoint when running locally.
4. Create an isolated browser context per viewport.
5. Visit each declared route and collect browser events.
6. Capture immutable evidence and content digests.
7. Evaluate diagnostics against explicit failure policy.
8. Stop the local process and write one receipt.

## Trust model

The initial worker is single-operator and trusted-code only. Renderprove does not attempt hostile multi-tenancy.

- Commands use argument arrays and `shell: false`.
- Ambient environment inheritance is intentionally narrow.
- Project output stays beneath a validated output root.
- Local targets use loopback addresses.
- Browser contexts are isolated by viewport and discarded after review.
- Fork pull requests must not automatically reach personal self-hosted workers.

## Adapter direction

Framework support should normalize into the same manifest rather than branching the receipt model.

- Static adapter: start a repository-owned static server.
- Vite adapter: suggest the common host and port arguments.
- Next adapter: suggest the common hostname and port arguments.
- Custom adapter: use a committed argument-array command.
- Deployed adapter: review an existing HTTP origin without starting a process.

Autodetection may propose configuration later. Committed configuration remains authoritative.

## Agent interface

The future MCP surface should expose project operations such as `inspect_project`, `review_project`, `compare_receipts`, and `stop_preview`. Raw unrestricted Chrome control stays an implementation detail or trusted local diagnostic mode.
