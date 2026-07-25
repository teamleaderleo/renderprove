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
  'src/version.mjs',
  'src/mcp/server.mjs',
  'src/probe/repeatability.mjs',
  'schema/manifest-v1.schema.json',
  'schema/receipt-v1.schema.json',
  'build/worker/Containerfile',
  'scripts/probe-podman.sh',
  'scripts/probe-repeatability.sh',
  'scripts/repeatability-report.mjs',
  'scripts/worker-identity.mjs',
  'docs/ARCHITECTURE.md',
  'docs/MCP.md',
  'docs/RECEIPT_V1.md',
  'docs/SELF_HOSTED_PROBE.md',
];
for (const file of required) {
  if (!files.has(file)) throw new Error(`npm package is missing ${file}`);
}
for (const privatePath of ['tests/core.test.mjs', 'tests/mcp.test.mjs', 'tests/repeatability.test.mjs', '.github/workflows/ci.yml']) {
  if (files.has(privatePath)) throw new Error(`npm package unexpectedly includes ${privatePath}`);
}
console.log(`Validated npm package ${pack.name}@${pack.version} with ${files.size} files.`);
