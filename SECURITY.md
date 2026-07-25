# Security policy

## Supported versions

Renderprove is pre-1.0. Security fixes apply to the latest commit on `main` until releases begin.

## Reporting

Report vulnerabilities privately through GitHub's security advisory interface. Avoid public issues for credential exposure, command execution, path traversal, browser-profile leakage, MCP root escapes, interaction-plan boundary escapes, AI advisory data leaks, or worker-isolation failures.

## Operator guidance

Renderprove executes repository-declared commands. Treat a review request as code execution on the selected worker.

- Run only trusted revisions.
- Deny automatic execution from public forks.
- Use dedicated unprivileged accounts or isolated containers.
- Keep browser profiles ephemeral.
- Never expose a browser debugging port publicly.
- Choose the narrowest practical root for `renderprove-mcp`.
- Review MCP client configuration before approving the local server.
- Put future remote MCP behind authentication, narrow project scopes, origin allowlists, and explicit tenancy controls.
- Keep production mutation outside review credentials.
- Retain screenshots and traces only as long as needed.
- Treat `renderprove advise` as an explicit transfer of sanitized source and receipt data to an external provider.
- Inspect `renderprove advise --dry-run --json` before enabling advisory review for a sensitive repository.
- Keep Cloudflare API tokens in the caller environment and out of the project checkout, manifest, logs, screenshots, and artifacts.
- Never expose provider credentials to untrusted fork workflows.

The stdio MCP server resolves its configured root and selected projects through real paths, rejects project and manifest escapes, checks runtime and evidence paths, and excludes raw host paths, commands, environment values, logs, and stacks from tool responses. These controls reduce accidental exposure; they do not sandbox the repository runtime.

Interaction plan v1 exposes a closed set of pointer, form, wait, and capture operations. It rejects unknown fields and excludes arbitrary JavaScript, shell, file transfer, clipboard, unrestricted keyboard, and raw browser-control operations. Plans can still enter sensitive text and capture sensitive pixels; operators must control plan sources, capture destinations, and artifact retention.

The optional AI advisor resolves included paths beneath the project root, skips symlinks and common secret-bearing paths, filters binary and oversized files, and redacts several common credential patterns before transfer. These checks are guardrails rather than complete data-loss prevention. The generated `advice.json` retains only file metadata, digests, redaction counts, omissions, normalized findings, and provider usage; it excludes transmitted source content and provider credentials.

Advisory file contents are treated as untrusted evidence in the model prompt. Prompt-injection resistance cannot be guaranteed. AI findings are always marked non-authoritative and never alter the deterministic browser receipt or review exit code.

The initial release is designed for a single trusted operator. It is not a hostile multi-tenant sandbox.
