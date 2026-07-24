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
  'schema/manifest-v1.schema.json',
  'schema/receipt-v1.schema.json',
  'docs/ARCHITECTURE.md',
  'docs/RECEIPT_V1.md'
];

for (const file of required) await fs.access(new URL(`../${file}`, import.meta.url));
for (const schema of ['manifest-v1.schema.json', 'receipt-v1.schema.json']) {
  const parsed = JSON.parse(await fs.readFile(new URL(`../schema/${schema}`, import.meta.url), 'utf8'));
  if (parsed.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    throw new Error(`${schema} must use JSON Schema 2020-12`);
  }
}
const packageJson = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (packageJson.name !== 'renderprove') throw new Error('package name must be renderprove');
if (packageJson.license !== 'Apache-2.0') throw new Error('license must be Apache-2.0');
console.log(`Validated ${required.length} required files.`);
