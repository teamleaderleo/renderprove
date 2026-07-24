# Security policy

## Supported versions

Renderprove is pre-1.0. Security fixes apply to the latest commit on `main` until releases begin.

## Reporting

Report vulnerabilities privately through GitHub's security advisory interface. Avoid public issues for credential exposure, command execution, path traversal, browser-profile leakage, or worker-isolation failures.

## Operator guidance

Renderprove executes repository-declared commands. Treat a review request as code execution on the selected worker.

- Run only trusted revisions.
- Deny automatic execution from public forks.
- Use dedicated unprivileged accounts or isolated containers.
- Keep browser profiles ephemeral.
- Never expose a browser debugging port publicly.
- Put remote MCP behind authentication, narrow project scopes, and origin allowlists.
- Keep production mutation outside review credentials.
- Retain screenshots and traces only as long as needed.

The initial release is designed for a single trusted operator. It is not a hostile multi-tenant sandbox.
