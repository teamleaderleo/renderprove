import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { reviewProject } from '../src/service.mjs';

const projectRoot = path.dirname(fileURLToPath(new URL('./fixtures/site/renderprove.json', import.meta.url)));
const { receipt, receiptPath } = await reviewProject({ projectRoot });
assert.equal(receipt.status, 'passed');
assert.equal(receipt.cases.length, 2);
assert.equal(receipt.cases.every((item) => item.artifacts[0]?.sha256?.length === 64), true);
await fs.access(receiptPath);
console.log(`Browser receipt passed: ${receiptPath}`);
