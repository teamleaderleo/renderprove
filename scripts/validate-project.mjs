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
  'src/advice.mjs',
  'src/advice/bundle.mjs',
  'src/advice/cloudflare.mjs',
  'src/advice/policy.mjs',
  'src/advice/service.mjs',
  'src/interaction.mjs',
  'src/version.mjs',
  'src/core/manifest.mjs',
  'src/core/receipt.mjs',
  'src/runtime/process.mjs',
  'src/browser/review.mjs',
  'src/browser/interaction-plan.mjs',
  'src/browser/interaction-executor.mjs',
  'src/mcp/cli.mjs',
  'src/mcp/projects.mjs',
  'src/mcp/results.mjs',
  'src/mcp/review-gate.mjs',
  'src/mcp/server.mjs',
  'src/probe/enrollment.mjs',
  'src/probe/repeatability.mjs',
  'schema/advice-v1.schema.json',
  'schema/interaction-plan-v1.schema.json',
  'schema/manifest-v1.schema.json',
  'schema/receipt-v1.schema.json',
  'scripts/validate-package.mjs',
  'scripts/worker-identity.mjs',
  'scripts/probe-paths.mjs',
  'scripts/probe-podman.sh',
  'scripts/probe-repeatability.sh',
  'scripts/repeatability-report.mjs',
  'build/worker/Containerfile',
  'docs/AI_ADVISORY.md',
  'docs/ARCHITECTURE.md',
  'docs/INTERACTIONS.md',
  'docs/MCP.md',
  'docs/RECEIPT_V1.md',
  'docs/SELF_HOSTED_PROBE.md',
  'tests/advice-bundle.test.mjs',
  'tests/advice-cloudflare.test.mjs',
  'tests/advice-policy.test.mjs',
  'tests/interaction-plan.test.mjs',
  'tests/interaction-coordinates.test.mjs',
  'tests/probe-enrollment.test.mjs',
  'tests/repeatability.test.mjs'
];

for (const file of required) await fs.access(new URL(`../${file}`, import.meta.url));
for (const schema of ['advice-v1.schema.json', 'interaction-plan-v1.schema.json', 'manifest-v1.schema.json', 'receipt-v1.schema.json']) {
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
if (packageJson.exports?.['./advice'] !== './src/advice.mjs') {
  throw new Error('package must expose the optional advisory API');
}
if (packageJson.exports?.['./interaction'] !== './src/interaction.mjs') {
  throw new Error('package must expose the bounded interaction API');
}
if (packageJson.exports?.['./schema/advice-v1.schema.json'] !== './schema/advice-v1.schema.json') {
  throw new Error('package must expose the advice result schema');
}
if (packageJson.exports?.['./schema/interaction-plan-v1.schema.json'] !== './schema/interaction-plan-v1.schema.json') {
  throw new Error('package must expose the interaction plan schema');
}
if (packageJson.scripts?.['probe:podman'] !== 'bash scripts/probe-podman.sh') {
  throw new Error('package must expose the Podman renderer probe');
}
if (packageJson.scripts?.['probe:repeatability'] !== 'bash scripts/probe-repeatability.sh') {
  throw new Error('package must expose the repeatability probe');
}
if (packageJson.scripts?.['worker:identity'] !== 'node scripts/worker-identity.mjs') {
  throw new Error('package must expose worker identity collection');
}
if (packageJson.license !== 'Apache-2.0') throw new Error('license must be Apache-2.0');
console.log(`Validated ${required.length} required files.`);
