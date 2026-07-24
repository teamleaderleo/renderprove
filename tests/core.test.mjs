import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeManifest } from '../src/core/manifest.mjs';
import { safeSegment, resolveInside } from '../src/core/paths.mjs';
import { createReceipt, summarizeReceipt } from '../src/core/receipt.mjs';
import { caseStatus, shouldFail } from '../src/browser/diagnostics.mjs';
import { parseArgs } from '../src/cli.mjs';
import { startRuntime } from '../src/runtime/process.mjs';

const deployed = {
  version: 1,
  project: 'example',
  target: { baseUrl: 'https://example.com/' },
  review: { routes: ['/', '/about'] },
};

test('normalizes deployed URL manifests and default viewports', () => {
  const manifest = normalizeManifest(deployed, { projectRoot: '/tmp/example' });
  assert.equal(manifest.target.baseUrl, 'https://example.com');
  assert.equal(manifest.review.viewports.length, 2);
  assert.equal(manifest.review.routes[1].name, '/about');
});

test('normalizes a shell-free local runtime', () => {
  const manifest = normalizeManifest({
    ...deployed,
    target: undefined,
    runtime: { command: ['npm', 'run', 'dev'], port: 4173 },
  });
  assert.deepEqual(manifest.runtime.command, ['npm', 'run', 'dev']);
  assert.equal(manifest.runtime.readyPath, '/');
});

test('requires exactly one target mode', () => {
  assert.throws(() => normalizeManifest({ ...deployed, runtime: { command: ['x'], port: 4000 } }), /Exactly one/);
  assert.throws(() => normalizeManifest({ ...deployed, target: undefined }), /Exactly one/);
});

test('rejects unknown fields, shell commands, embedded credentials, and escaping cwd', () => {
  assert.throws(() => normalizeManifest({ ...deployed, surprise: true }), /unknown fields/);
  assert.throws(() => normalizeManifest({ ...deployed, target: undefined, runtime: { command: 'npm run dev', port: 4173 } }), /string array/);
  assert.throws(() => normalizeManifest({ ...deployed, target: { baseUrl: 'https://user:secret@example.com' } }), /HTTP or HTTPS URL/);
  assert.throws(() => normalizeManifest({
    ...deployed,
    target: undefined,
    runtime: { command: ['npm'], port: 4173, cwd: '../elsewhere' },
  }, { projectRoot: '/tmp/project' }), /inside the project root/);
});

test('accepts named custom viewports and explicit route settings', () => {
  const manifest = normalizeManifest({
    ...deployed,
    review: {
      routes: [{ path: '/', name: 'home', waitForMs: 0, fullPage: false }],
      viewports: [{ name: 'wide', width: 1920, height: 1080 }],
    },
  });
  assert.equal(manifest.review.viewports[0].name, 'wide');
  assert.equal(manifest.review.routes[0].waitForMs, 0);
});

test('creates stable artifact-safe paths', () => {
  assert.equal(safeSegment('Mobile / Sign in'), 'mobile-sign-in');
  assert.equal(safeSegment('../../'), 'artifact');
  assert.match(resolveInside('/tmp/output', 'screenshots', 'home.png'), /output.*screenshots.*home\.png$/);
  assert.throws(() => resolveInside('/tmp/output', '..', 'secret'), /escapes/);
});

test('summarizes passing and failing receipt cases', () => {
  const manifest = { project: 'demo', projectRoot: '/demo', sourcePath: '/demo/renderprove.json' };
  const receipt = createReceipt({
    manifest,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    baseUrl: 'http://127.0.0.1:4000',
    runtime: { mode: 'local' },
    cases: [
      { status: 'passed', diagnostics: [] },
      { status: 'failed', diagnostics: [{ kind: 'console' }] },
    ],
  });
  assert.equal(receipt.status, 'failed');
  assert.deepEqual(receipt.summary, { cases: 2, passed: 1, failed: 1, diagnostics: 1 });
  assert.match(summarizeReceipt(receipt), /1\/2/);
});

test('maps diagnostics to explicit failure policy', () => {
  const strict = { consoleError: true, pageError: true, requestFailure: true, httpError: true };
  assert.equal(shouldFail({ kind: 'console' }, strict), true);
  assert.equal(caseStatus([{ kind: 'http' }], { ...strict, httpError: false }), 'passed');
  assert.equal(caseStatus([{ kind: 'page' }], strict), 'failed');
});

test('parses project and review CLI options', () => {
  assert.deepEqual(parseArgs(['review', './app', '--manifest', 'qa.json', '--output', 'proof', '--headed', '--json']), {
    command: 'review',
    projectRoot: './app',
    manifest: 'qa.json',
    output: 'proof',
    headed: true,
    json: true,
  });
  assert.throws(() => parseArgs(['review', '--wat']), /Unknown option/);
});

test('starts a loopback runtime and observes readiness', async () => {
  const fixtureRoot = path.dirname(fileURLToPath(new URL('./fixtures/site/server.mjs', import.meta.url)));
  const manifest = normalizeManifest({
    version: 1,
    project: 'fixture',
    runtime: {
      command: [process.execPath, 'server.mjs'],
      cwd: '.',
      port: 43127,
      readyPath: '/health',
      timeoutMs: 5_000,
    },
    review: { routes: ['/'] },
  }, { projectRoot: fixtureRoot });
  const runtime = await startRuntime(manifest);
  try {
    const response = await fetch(`${runtime.baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.equal(runtime.details.mode, 'local');
  } finally {
    await runtime.stop();
  }
});
