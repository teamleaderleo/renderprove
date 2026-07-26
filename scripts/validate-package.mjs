import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: new URL('..', import.meta.url),
  maxBuffer: 2 * 1024 * 1024,
});
const [pack] = JSON.parse(stdout);
const files = new Set(pack.files.map((file) => file.path));
const required = [
  'LICENSE',
  'README.md',
  'SECURITY.md',
  'package.json',
  'bin/renderprove.mjs',
  'bin/renderprove-mcp.mjs',
  'src/index.mjs',
  'src/advice.mjs',
  'src/advice/bundle.mjs',
  'src/advice/cloudflare.mjs',
  'src/advice/policy.mjs',
  'src/advice/service.mjs',
  'src/visual.mjs',
  'src/visual/comparison.mjs',
  'src/visual/delta-e.mjs',
  'src/visual/png.mjs',
  'src/interaction.mjs',
  'src/version.mjs',
  'src/browser/interaction-plan.mjs',
  'src/browser/interaction-executor.mjs',
  'src/mcp/server.mjs',
  'src/probe/enrollment.mjs',
  'src/probe/repeatability.mjs',
  'schema/advice-v1.schema.json',
  'schema/interaction-plan-v1.schema.json',
  'schema/manifest-v1.schema.json',
  'schema/receipt-v1.schema.json',
  'schema/visual-comparison-v1.schema.json',
  'build/worker/Containerfile',
  'scripts/probe-paths.mjs',
  'scripts/probe-podman.sh',
  'scripts/probe-repeatability.sh',
  'scripts/repeatability-report.mjs',
  'scripts/worker-identity.mjs',
  'docs/AI_ADVISORY.md',
  'docs/ARCHITECTURE.md',
  'docs/INTERACTIONS.md',
  'docs/MCP.md',
  'docs/RECEIPT_V1.md',
  'docs/SELF_HOSTED_PROBE.md',
  'docs/VISUAL_COMPARISON.md',
];
for (const file of required) {
  if (!files.has(file)) throw new Error(`npm package is missing ${file}`);
}
for (const privatePath of [
  'tests/core.test.mjs',
  'tests/mcp.test.mjs',
  'tests/advice-bundle.test.mjs',
  'tests/advice-cloudflare.test.mjs',
  'tests/advice-policy.test.mjs',
  'tests/visual-comparison.test.mjs',
  'tests/interaction-plan.test.mjs',
  'tests/interaction-coordinates.test.mjs',
  'tests/probe-enrollment.test.mjs',
  'tests/repeatability.test.mjs',
  '.github/workflows/ci.yml',
]) {
  if (files.has(privatePath)) throw new Error(`npm package unexpectedly includes ${privatePath}`);
}
console.log(`Validated npm package ${pack.name}@${pack.version} with ${files.size} files.`);
