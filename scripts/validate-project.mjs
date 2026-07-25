import fs from 'node:fs/promises';
import { VERSION } from '../src/version.mjs';

const required = [
  'README.md',
  'LICENSE',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'package.json',
  'package-lock.json',
  'bin/renderprove.mjs',
  'bin/renderprove-mcp.mjs',
  'src/cli.mjs',
  'src/service.mjs',
  'src/version.mjs',
  'src/core/manifest.mjs',
  'src/core/receipt.mjs',
  'src/runtime/process.mjs',
  'src/browser/review.mjs',
  'src/mcp/cli.mjs',
  'src/mcp/projects.mjs',
  'src/mcp/results.mjs',
  'src/mcp/review-gate.mjs',
  'src/mcp/server.mjs',
  'schema/manifest-v1.schema.json',
  'schema/receipt-v1.schema.json',
  'scripts/validate-package.mjs',
  'scripts/worker-identity.mjs',
  'scripts/probe-podman.sh',
  'build/worker/Containerfile',
  'docs/ARCHITECTURE.md',
  'docs/MCP.md',
  'docs/RECEIPT_V1.md',
  'docs/SELF_HOSTED_PROBE.md'
];

for (const file of required) await fs.access(new URL(`../${file}`, import.meta.url));
for (const schema of ['manifest-v1.schema.json', 'receipt-v1.schema.json']) {
  const parsed = JSON.parse(await fs.readFile(new URL(`../schema/${schema}`, import.meta.url), 'utf8'));
  if (parsed.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    throw new Error(`${schema} must use JSON Schema 2020-12`);
  }
}
const packageJson = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
const packageLock = JSON.parse(await fs.readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
if (packageJson.name !== 'renderprove') throw new Error('package name must be renderprove');
if (packageJson.version !== VERSION) throw new Error('package and CLI versions must match');
if (packageLock.version !== VERSION || packageLock.packages['']?.version !== VERSION) {
  throw new Error('package lock version must match the package version');
}
if (packageJson.bin?.['renderprove-mcp'] !== './bin/renderprove-mcp.mjs') {
  throw new Error('package must expose the renderprove-mcp executable');
}
if (packageJson.scripts?.['probe:podman'] !== 'bash scripts/probe-podman.sh') {
  throw new Error('package must expose the Podman renderer probe');
}
if (packageJson.scripts?.['worker:identity'] !== 'node scripts/worker-identity.mjs') {
  throw new Error('package must expose worker identity collection');
}
if (packageJson.license !== 'Apache-2.0') throw new Error('license must be Apache-2.0');
console.log(`Validated ${required.length} required files.`);
