import fs from 'node:fs/promises';

const required = [
  'README.md',
  'LICENSE',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'package.json',
  'bin/renderprove.mjs',
  'src/cli.mjs',
  'src/service.mjs',
  'src/core/manifest.mjs',
  'src/core/receipt.mjs',
  'src/runtime/process.mjs',
  'src/browser/review.mjs',
  'docs/ARCHITECTURE.md',
  'docs/RECEIPT_V1.md'
];

for (const file of required) await fs.access(new URL(`../${file}`, import.meta.url));
const packageJson = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (packageJson.name !== 'renderprove') throw new Error('package name must be renderprove');
if (packageJson.license !== 'Apache-2.0') throw new Error('license must be Apache-2.0');
console.log(`Validated ${required.length} required files.`);
