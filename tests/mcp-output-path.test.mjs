import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeManifestForMcp } from '../src/mcp/results.mjs';

test('MCP inspection reports evidence output relative to the enrolled project', () => {
  const manifest = {
    version: 1,
    project: 'demo',
    projectRoot: '/private/worker/demo',
    sourcePath: '/private/worker/demo/renderprove.json',
    runtime: null,
    target: { baseUrl: 'https://example.com' },
    review: {
      routes: [{ path: '/', name: '/', waitForMs: 250, fullPage: true }],
      viewports: [{ name: 'desktop', width: 1440, height: 1000, deviceScaleFactor: 1 }],
      failOn: { consoleError: true, pageError: true, requestFailure: true, httpError: true },
      outputDir: '/private/worker/demo/.proof',
      navigationTimeoutMs: 30_000,
    },
  };

  const result = sanitizeManifestForMcp(manifest, 'demo');
  assert.equal(result.review.outputDir, '.proof');
  assert.equal(JSON.stringify(result).includes('/private/worker'), false);
});
