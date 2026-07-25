import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const fixturesRoot = path.join(repoRoot, 'tests', 'fixtures');
const projectRoot = path.join(fixturesRoot, 'site');
const mcpBin = path.join(repoRoot, 'bin', 'renderprove-mcp.mjs');
const receiptPath = path.join(projectRoot, '.proof', 'receipt.json');

function parseToolPayload(result) {
  assert.equal(result.content[0]?.type, 'text');
  return JSON.parse(result.content[0].text);
}

await fs.rm(path.dirname(receiptPath), { recursive: true, force: true });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [mcpBin, '--root', fixturesRoot],
});
const client = new Client({ name: 'renderprove-browser-test-client', version: '1.0.0' });
try {
  await client.connect(transport);
  const result = await client.callTool(
    {
      name: 'review_project',
      arguments: { project: 'site' },
    },
    { timeout: 120_000 },
  );
  assert.equal(result.isError, undefined);
  const payload = parseToolPayload(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.value.status, 'passed');
  assert.equal(payload.value.source.projectPath, 'site');
  assert.deepEqual(payload.value.runtime, { mode: 'local' });
  assert.equal(payload.value.cases.length, 2);
  assert.equal(payload.value.cases.every((item) => item.artifacts[0]?.sha256?.length === 64), true);
  assert.equal(JSON.stringify(payload.value).includes(process.cwd()), false);
  await fs.access(receiptPath);
  console.log(`MCP browser receipt passed: ${receiptPath}`);
} finally {
  await client.close();
}
