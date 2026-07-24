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
  'src/index.mjs',
  'src/version.mjs',
  'schema/manifest-v1.schema.json',
  'schema/receipt-v1.schema.json',
  'docs/ARCHITECTURE.md',
  'docs/RECEIPT_V1.md',
];
for (const file of required) {
  if (!files.has(file)) throw new Error(`npm package is missing ${file}`);
}
for (const privatePath of ['tests/core.test.mjs', '.github/workflows/ci.yml']) {
  if (files.has(privatePath)) throw new Error(`npm package unexpectedly includes ${privatePath}`);
}
console.log(`Validated npm package ${pack.name}@${pack.version} with ${files.size} files.`);
