# Local stdio MCP

Renderprove exposes a deliberately narrow local MCP server for trusted coding agents. It wraps the same manifest, runtime, browser, and receipt implementation used by the CLI. It does not expose arbitrary shell execution or unrestricted Chrome control.

## Start the server

Select the directory whose descendants may be addressed as projects:

```bash
renderprove-mcp --root /Users/you/Projects
```

The root is an operator decision made when the process starts. Tool arguments cannot widen it. The root and selected project are resolved through real paths, so a project symlink cannot point outside the enrolled tree.

A generic local MCP client configuration looks like:

```json
{
  "mcpServers": {
    "renderprove": {
      "command": "node",
      "args": [
        "/absolute/path/to/renderprove/bin/renderprove-mcp.mjs",
        "--root",
        "/Users/you/Projects"
      ]
    }
  }
}
```

After an npm release, the command may instead point at the installed `renderprove-mcp` executable.

## Tools

### `inspect_project`

Validates one project and returns a sanitized summary without starting its runtime or browser.

Arguments:

- `project`: optional path beneath the configured root; defaults to the root itself
- `manifest`: optional manifest path beneath the selected project

The result includes routes, viewports, policy, target origin or local port, and project-relative provenance. Runtime commands, environment values, absolute worker paths, and log contents are omitted.

### `review_project`

Runs the existing Renderprove review and returns a sanitized receipt.

Arguments are identical to `inspect_project`. Reviews are always headless through MCP. A second review for the same real project path receives `MCP_PROJECT_BUSY` until the first review releases its claim.

Clients should permit a longer tool timeout for browser reviews. The initial implementation completes within the tool call rather than creating a background task. When the client cancels or times out the request, Renderprove closes the active page, browser context, browser, and local project process; it releases the project claim and skips receipt creation rather than recording cancellation as a failed review.

## Result envelope

Successful tools return one JSON text item:

```json
{
  "ok": true,
  "summary": "my-app: 4/4 cases passed with 0 diagnostics.",
  "value": {}
}
```

Expected tool failures use `isError: true` and a sanitized code and message:

```json
{
  "ok": false,
  "error": {
    "code": "MCP_PROJECT_OUTSIDE_ROOT",
    "message": "The project must stay inside the configured MCP root."
  }
}
```

Worker paths, raw exception text, runtime output, and stack traces are excluded from tool responses.

## Security boundary

The local server is for one trusted operator and trusted repository revisions.

- Repository-declared runtime commands still execute on the worker.
- Project and manifest real paths must remain beneath the configured root.
- Runtime working and evidence output paths are checked before browser execution.
- Existing symlinked evidence directories cannot redirect writes outside the project.
- Each browser review case still receives a fresh isolated browser context.
- Cancellation propagates through the MCP request into browser and process cleanup.
- stdout is reserved entirely for MCP JSON-RPC; operator errors use stderr.
- Remote HTTP transport, authentication, shared tenancy, and arbitrary browser tools remain outside this release.

A project can execute arbitrary code once its declared runtime starts. Filesystem path checks are defence in depth, not a substitute for a Glaeda container or another worker sandbox when revisions are untrusted.
