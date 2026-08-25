# Architecture

## Product boundary

Renderprove owns project-aware inspection. It does not own durable coordination, general CI scheduling, production deployment, or arbitrary agent reasoning.

- **Renderprove:** manifests, project startup, browser review, bounded interactions, evidence, receipts, bounded inspection tools, and optional bounded advisory bundles.
- **Glaeda:** trusted workers, bounded execution, leased workspaces and previews.
- **Stensibly:** requests, claims, handoffs, events, and artifact references.
- **Playwright:** browser implementation behind Renderprove's narrower contract.
- **Cloudflare Workers AI:** optional external model execution behind Renderprove's sanitized advisory contract.

Every integration is optional. The CLI, interaction engine, and receipt format remain useful without either neighboring project or an AI provider.

## Execution flow

1. Load and strictly validate a revisioned project manifest.
2. Start exactly one declared local process or use one declared HTTP origin.
3. Wait for a same-origin loopback readiness path when running locally.
4. Create a fresh isolated browser context for each route and viewport case.
5. Visit the declared same-origin route and collect browser events.
6. Optionally run a separately validated bounded interaction plan.
7. Capture immutable evidence and content digests.
8. Evaluate diagnostics against explicit failure policy.
9. Stop the local process and write one receipt.
10. At explicit operator request, build a bounded sanitized source-and-receipt bundle, send it to one configured advisory provider, and write a separate non-authoritative artifact.

Interaction plans are standalone in the current release. Manifest v1 and receipt v1 remain unchanged until interaction results and capture provenance receive their own evidence contract.

The advisory path is also standalone. It never changes receipt v1, browser policy, or the deterministic review exit code. Provider output is normalized into `advice-v1` and marked `authoritative: false`.

## Trust model

The initial worker is single-operator and trusted-code only. Renderprove does not attempt hostile multi-tenancy.

- Commands use argument arrays and `shell: false`.
- Ambient environment inheritance is intentionally narrow.
- Project output stays beneath a validated output root.
- Local targets use loopback addresses.
- Route and readiness paths cannot switch to another origin.
- Browser contexts are isolated per review case and discarded immediately.
- Interaction plans expose a closed vocabulary without arbitrary JavaScript, shell, file transfer, clipboard, or raw browser-control operations.
- AI advice requires an explicit command and external provider credentials.
- Advisory inputs are path-contained, size-bounded, filtered, redacted, and inspectable through dry-run mode.
- Provider credentials and transmitted source content are excluded from the persisted advisory artifact.
- Fork pull requests must not automatically reach personal self-hosted workers or provider credentials.

The CLI's lexical path checks assume trusted repository contents. The local MCP adds operator-root and selected-project real-path checks, plus runtime and evidence-directory checks. A repository runtime can still execute arbitrary code; symlink-hostile or untrusted workspaces require a stronger sandbox boundary such as a Glaeda-managed container.

Secret filtering and prompt-injection instructions reduce common advisory risks without proving confidentiality or model compliance. Sensitive repositories need operator inspection of the dry-run bundle and a deliberate provider policy.

## Agent interface

The first agent interface is local stdio MCP with two tools:

- `inspect_project`: validate and summarize enrolled configuration
- `review_project`: run the existing browser review and return a sanitized receipt

The operator fixes the project root at process startup. Tool calls cannot widen that root, choose arbitrary commands, receive environment values or runtime logs, or control Chrome directly. One project review may run at a time per MCP process.

AI advice is initially available through the explicit CLI and `renderprove/advice` library export rather than MCP. This keeps provider credentials, external data transfer, and retention under direct operator control. A future MCP advisory tool needs a separate disclosure and authorization design.

Remote HTTP transport requires a separate authentication and tenancy design. Raw browser control remains an implementation detail or a trusted local diagnostic mode rather than part of Renderprove's public agent contract.

## Adapter direction

Framework support should normalize into the same manifest rather than branching the receipt model.

- Static adapter: start a repository-owned static server.
- Vite adapter: suggest the common host and port arguments.
- Next adapter: suggest the common hostname and port arguments.
- Custom adapter: use a committed argument-array command.
- Deployed adapter: review an existing HTTP origin without starting a process.

Autodetection may propose configuration later. Committed configuration remains authoritative.
