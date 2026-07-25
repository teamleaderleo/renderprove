import path from 'node:path';
import { RenderproveError } from '../core/errors.mjs';

function relativeManifest(projectRoot, sourcePath) {
  if (!sourcePath) return null;
  const relative = path.relative(projectRoot, sourcePath);
  return relative || path.basename(sourcePath);
}

export function sanitizeManifestForMcp(manifest, projectPath) {
  return {
    version: manifest.version,
    project: manifest.project,
    projectPath,
    manifest: relativeManifest(manifest.projectRoot, manifest.sourcePath),
    mode: manifest.runtime ? 'local' : 'remote',
    runtime: manifest.runtime ? {
      port: manifest.runtime.port,
      readyPath: manifest.runtime.readyPath,
      timeoutMs: manifest.runtime.timeoutMs,
      shutdownMs: manifest.runtime.shutdownMs,
    } : null,
    target: manifest.target ? { baseUrl: manifest.target.baseUrl } : null,
    review: {
      routes: manifest.review.routes.map(({ path: routePath, name, waitForMs, fullPage }) => ({
        path: routePath,
        name,
        waitForMs,
        fullPage,
      })),
      viewports: manifest.review.viewports.map(({ name, width, height, deviceScaleFactor }) => ({
        name,
        width,
        height,
        deviceScaleFactor,
      })),
      failOn: { ...manifest.review.failOn },
      outputDir: manifest.review.outputDir,
      navigationTimeoutMs: manifest.review.navigationTimeoutMs,
    },
  };
}

export function sanitizeReceiptForMcp(receipt, projectPath) {
  return {
    ...receipt,
    source: {
      ...receipt.source,
      projectPath,
    },
    runtime: { mode: receipt.runtime?.mode ?? 'unknown' },
  };
}

export function toolSuccess(value, summary) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: true, summary, value }) }],
  };
}

export function toolFailure(error) {
  const code = error instanceof RenderproveError ? error.code : 'MCP_OPERATION_FAILED';
  const messages = {
    INVALID_MCP_ROOT: 'The configured MCP root is invalid.',
    MCP_PATH_UNAVAILABLE: 'The selected path does not exist or cannot be read.',
    MCP_PATH_NOT_DIRECTORY: 'The selected path must be a directory.',
    INVALID_MCP_PROJECT: 'The project path is invalid.',
    MCP_PROJECT_OUTSIDE_ROOT: 'The project must stay inside the configured MCP root.',
    MCP_MANIFEST_UNAVAILABLE: 'The manifest does not exist or cannot be read.',
    MCP_MANIFEST_OUTSIDE_PROJECT: 'The manifest must stay inside the selected project.',
    MCP_PROJECT_BUSY: 'A review is already running for this project.',
    MANIFEST_NOT_FOUND: 'No Renderprove manifest was found in the selected project.',
    INVALID_MANIFEST_JSON: 'The Renderprove manifest is not valid JSON.',
    INVALID_MANIFEST: 'The Renderprove manifest is invalid.',
    UNSUPPORTED_MANIFEST_VERSION: 'The Renderprove manifest version is unsupported.',
    PLAYWRIGHT_UNAVAILABLE: 'Playwright or Chromium is unavailable on this worker.',
    RUNTIME_EXITED: 'The project process exited before becoming ready.',
    RUNTIME_TIMEOUT: 'The project process did not become ready before the timeout.',
  };
  return {
    isError: true,
    content: [{
      type: 'text',
      text: JSON.stringify({
        ok: false,
        error: {
          code,
          message: messages[code] ?? 'The Renderprove operation failed. Check worker diagnostics.',
        },
      }),
    }],
  };
}
