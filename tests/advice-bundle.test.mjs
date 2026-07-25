import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildAdviceBundle, summarizeAdviceBundle } from '../src/advice/bundle.mjs';
import { parseArgs } from '../src/cli.mjs';

async function makeProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'renderprove-advice-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, '.renderprove'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules', 'ignored'), { recursive: true });
  await fs.writeFile(path.join(root, 'renderprove.json'), JSON.stringify({
    version: 1,
    project: 'advice-fixture',
    target: { baseUrl: 'https://example.com' },
    review: { routes: ['/'] },
  }));
  await fs.writeFile(path.join(root, '.renderprove', 'receipt.json'), JSON.stringify({
    version: 1,
    project: 'advice-fixture',
    status: 'passed',
    cases: [],
  }));
  await fs.writeFile(path.join(root, 'README.md'), '# Advice fixture\n');
  await fs.writeFile(path.join(root, 'src', 'app.ts'), 'const apiKey = "super-secret-value";\nexport const ready = true;\n');
  await fs.writeFile(path.join(root, '.env'), 'CLOUDFLARE_API_TOKEN=hidden\n');
  await fs.writeFile(path.join(root, 'node_modules', 'ignored', 'index.js'), 'throw new Error("skip me")\n');
  return root;
}

test('builds a bounded deterministic bundle and redacts secret-like values', async (t) => {
  const root = await makeProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const first = await buildAdviceBundle({ projectRoot: root });
  const second = await buildAdviceBundle({ projectRoot: root });
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.project, 'advice-fixture');
  assert.equal(first.receipt, '.renderprove/receipt.json');
  assert.equal(first.files.some((file) => file.path === 'renderprove.json'), true);
  assert.equal(first.files.some((file) => file.path === '.renderprove/receipt.json'), true);
  assert.equal(first.files.some((file) => file.path === 'src/app.ts'), true);
  assert.equal(first.files.some((file) => file.path === '.env'), false);
  assert.equal(first.files.some((file) => file.path.startsWith('node_modules/')), false);
  assert.equal(first.omissions.some((item) => item.reason === 'sensitive-name' && item.path === '[sensitive-path]'), true);
  const source = first.files.find((file) => file.path === 'src/app.ts');
  assert.match(source.content, /\[REDACTED\]/);
  assert.doesNotMatch(source.content, /super-secret-value/);
  assert.equal(first.summary.redactions >= 1, true);

  const summary = summarizeAdviceBundle(first);
  assert.equal('content' in summary.files[0], false);
  assert.equal(summary.sha256, first.sha256);
});

test('honours explicit includes while retaining manifest and receipt evidence', async (t) => {
  const root = await makeProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bundle = await buildAdviceBundle({ projectRoot: root, includePaths: ['README.md'] });
  assert.deepEqual(bundle.files.map((file) => file.path), [
    'renderprove.json',
    '.renderprove/receipt.json',
    'README.md',
  ]);
});

test('rejects advisory paths outside the project', async (t) => {
  const root = await makeProject();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'renderprove-outside-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, 'outside.txt'), 'outside');
  await assert.rejects(
    () => buildAdviceBundle({ projectRoot: root, includePaths: [path.join(outside, 'outside.txt')] }),
    /inside the project root/,
  );
});

test('rejects a mandatory manifest symlink before building the provider bundle', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'renderprove-advice-link-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'renderprove-manifest-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const externalManifest = path.join(outside, 'renderprove.json');
  await fs.writeFile(externalManifest, JSON.stringify({
    version: 1,
    project: 'linked-fixture',
    target: { baseUrl: 'https://example.com' },
    review: { routes: ['/'] },
  }));
  await fs.symlink(externalManifest, path.join(root, 'renderprove.json'));
  await assert.rejects(() => buildAdviceBundle({ projectRoot: root }), /symbolic link/);
});

test('applies file and byte caps with explicit omissions', async (t) => {
  const root = await makeProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bundle = await buildAdviceBundle({ projectRoot: root, maxFiles: 2, maxBytes: 4_000 });
  assert.equal(bundle.files.length, 2);
  assert.equal(bundle.omissions.some((item) => item.reason === 'file-limit'), true);
});

test('parses ergonomic advise CLI options', () => {
  assert.deepEqual(parseArgs([
    'advise', './app', '--include', 'src', '--include', 'README.md', '--receipt', 'proof/receipt.json',
    '--model', '@cf/google/gemma-4-26b-a4b-it', '--max-files', '20', '--max-bytes', '200000',
    '--max-file-bytes', '50000', '--timeout', '45000', '--dry-run', '--json',
  ]), {
    command: 'advise',
    projectRoot: './app',
    json: true,
    headed: false,
    includePaths: ['src', 'README.md'],
    receipt: 'proof/receipt.json',
    model: '@cf/google/gemma-4-26b-a4b-it',
    maxFiles: 20,
    maxBytes: 200000,
    maxFileBytes: 50000,
    timeoutMs: 45000,
    dryRun: true,
  });
});
