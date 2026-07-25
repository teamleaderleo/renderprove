import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { parseMcpArgs } from '../src/mcp/cli.mjs';
import {
  assertMcpReviewPaths,
  resolveMcpManifest,
  resolveMcpProject,
  resolveOperatorRoot,
} from '../src/mcp/projects.mjs';
import { ProjectReviewGate } from '../src/mcp/review-gate.mjs';
import {
  sanitizeManifestForMcp,
  sanitizeReceiptForMcp,
  toolFailure,
} from '../src/mcp/results.mjs';
import { RenderproveError } from '../src/core/errors.mjs';

const repoRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const fixturesRoot = path.join(repoRoot, 'tests', 'fixtures');
const mcpBin = path.join(repoRoot, 'bin', 'renderprove-mcp.mjs');

function parseToolPayload(result) {
  assert.ok(Array.isArray(result.content));
  assert.equal(result.content[0]?.type, 'text');
  return JSON.parse(result.content[0].text);
}

test('parses explicit MCP root options', () => {
  assert.deepEqual(parseMcpArgs(['--root', './projects']), {
    root: './projects',
    help: false,
    version: false,
  });
  assert.equal(parseMcpArgs(['--help']).help, true);
  assert.equal(parseMcpArgs(['--version']).version, true);
  assert.throws(() => parseMcpArgs([]), /--root is required/);
  assert.throws(() => parseMcpArgs(['--wat']), /Unknown option/);
});

test('review gate preserves ownership and supports idempotent release', () => {
  const gate = new ProjectReviewGate();
  const release = gate.claim('/project');
  assert.equal(gate.isActive('/project'), true);
  assert.throws(() => gate.claim('/project'), (error) => error.code === 'MCP_PROJECT_BUSY');
  assert.equal(gate.isActive('/project'), true);
  release();
  release();
  assert.equal(gate.isActive('/project'), false);
  gate.claim('/project')();
});

test('MCP project and manifest resolution rejects real-path escapes', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'renderprove-mcp-paths-'));
  const root = path.join(sandbox, 'root');
  const project = path.join(root, 'project');
  const outside = path.join(sandbox, 'outside');
  await fs.mkdir(project, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(project, 'renderprove.json'), '{}\n');
  await fs.writeFile(path.join(outside, 'outside.json'), '{}\n');
  await fs.symlink(outside, path.join(root, 'linked-outside'));
  await fs.symlink(path.join(outside, 'outside.json'), path.join(project, 'linked.json'));

  try {
    const operatorRoot = await resolveOperatorRoot(root);
    const resolved = await resolveMcpProject(operatorRoot, 'project');
    assert.equal(resolved.projectPath, 'project');
    assert.equal(await resolveMcpManifest(resolved.projectRoot), 'renderprove.json');
    await assert.rejects(
      resolveMcpProject(operatorRoot, 'linked-outside'),
      (error) => error.code === 'MCP_PROJECT_OUTSIDE_ROOT',
    );
    await assert.rejects(
      resolveMcpManifest(resolved.projectRoot, 'linked.json'),
      (error) => error.code === 'MCP_MANIFEST_OUTSIDE_PROJECT',
    );
  } finally {
    await fs.rm(sandbox, { recursive: true, force: true });
  }
});

test('MCP review paths reject symlinked runtime and output escapes', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'renderprove-mcp-review-paths-'));
  const projectRoot = path.join(sandbox, 'project');
  const outside = path.join(sandbox, 'outside');
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.symlink(outside, path.join(projectRoot, 'outside-link'));

  try {
    await assert.rejects(
      assertMcpReviewPaths({
        projectRoot,
        runtime: { cwd: 'outside-link' },
        review: { outputDir: '.renderprove' },
      }),
      (error) => error.code === 'MCP_RUNTIME_OUTSIDE_PROJECT',
    );
    await assert.rejects(
      assertMcpReviewPaths({
        projectRoot,
        runtime: null,
        review: { outputDir: 'outside-link/proof' },
      }),
      (error) => error.code === 'MCP_OUTPUT_OUTSIDE_PROJECT',
    );
  } finally {
    await fs.rm(sandbox, { recursive: true, force: true });
  }
});

test('MCP responses omit commands, environments, logs, stacks, and absolute roots', () => {
  const manifest = {
    version: 1,
    project: 'demo',
    projectRoot: '/private/worker/demo',
    sourcePath: '/private/worker/demo/renderprove.json',
    runtime: {
      command: ['npm', 'run', 'dev'],
      cwd: '.',
      env: { SECRET: 'hidden' },
      port: 4173,
      readyPath: '/',
      timeoutMs: 30_000,
      shutdownMs: 5_000,
    },
    target: null,
    review: {
      routes: [{ path: '/', name: '/', waitForMs: 250, fullPage: true }],
      viewports: [{ name: 'desktop', width: 1440, height: 1000, deviceScaleFactor: 1 }],
      failOn: { consoleError: true, pageError: true, requestFailure: true, httpError: true },
      outputDir: '.renderprove',
      navigationTimeoutMs: 30_000,
    },
  };
  const sanitized = sanitizeManifestForMcp(manifest, 'demo');
  assert.equal(sanitized.manifest, 'renderprove.json');
  assert.equal(sanitized.projectPath, 'demo');
  assert.equal('command' in sanitized.runtime, false);
  assert.equal('env' in sanitized.runtime, false);
  assert.equal(JSON.stringify(sanitized).includes('/private/worker'), false);

  const receipt = sanitizeReceiptForMcp({
    version: 1,
    project: 'demo',
    source: { manifest: 'renderprove.json' },
    runtime: {
      mode: 'local',
      command: ['npm', 'run', 'dev'],
      logs: { stdout: 'secret output' },
    },
    cases: [{
      id: 'desktop:/',
      diagnostics: [{ kind: 'page', message: 'boom', stack: '/private/worker/demo/app.js:1' }],
    }],
  }, 'demo');
  assert.deepEqual(receipt.runtime, { mode: 'local' });
  assert.equal(receipt.source.projectPath, 'demo');
  assert.deepEqual(receipt.cases[0].diagnostics, [{ kind: 'page', message: 'boom' }]);
  assert.equal(JSON.stringify(receipt).includes('/private/worker'), false);

  const failure = parseToolPayload(toolFailure(new RenderproveError('/private/worker/demo failed', {
    code: 'UNKNOWN_PRIVATE_FAILURE',
  })));
  assert.equal(failure.error.code, 'UNKNOWN_PRIVATE_FAILURE');
  assert.equal(failure.error.message.includes('/private/worker'), false);
});

test('stdio MCP lists bounded tools and inspects an enrolled project', { timeout: 20_000 }, async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpBin, '--root', fixturesRoot],
  });
  const client = new Client({ name: 'renderprove-test-client', version: '1.0.0' });
  try {
    await client.connect(transport);
    const listing = await client.listTools();
    assert.deepEqual(listing.tools.map((tool) => tool.name).sort(), ['inspect_project', 'review_project']);

    const inspected = await client.callTool({
      name: 'inspect_project',
      arguments: { project: 'site' },
    });
    assert.notEqual(inspected.isError, true);
    const payload = parseToolPayload(inspected);
    assert.equal(payload.ok, true);
    assert.equal(payload.value.project, 'renderprove-fixture');
    assert.equal(payload.value.projectPath, 'site');
    assert.equal(payload.value.runtime.port, 43127);
    assert.equal('command' in payload.value.runtime, false);

    const escaped = await client.callTool({
      name: 'inspect_project',
      arguments: { project: '../..' },
    });
    assert.equal(escaped.isError, true);
    const escapedPayload = parseToolPayload(escaped);
    assert.equal(escapedPayload.error.code, 'MCP_PROJECT_OUTSIDE_ROOT');
  } finally {
    await client.close();
  }
});
