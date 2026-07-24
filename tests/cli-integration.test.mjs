import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { VERSION } from '../src/version.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const binPath = path.join(repositoryRoot, 'bin/renderprove.mjs');
const fixturePath = path.join(repositoryRoot, 'tests/fixtures/site');

test('reports the canonical version through the executable', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [binPath, 'version'], { cwd: repositoryRoot });
  assert.equal(stdout.trim(), VERSION);
  assert.equal(stderr, '');
});

test('inspects a project through the executable', async () => {
  const { stdout } = await execFileAsync(process.execPath, [binPath, 'inspect', fixturePath, '--json'], { cwd: repositoryRoot });
  const manifest = JSON.parse(stdout);
  assert.equal(manifest.project, 'renderprove-fixture');
  assert.equal(manifest.runtime.port, 4173);
  assert.equal(manifest.review.routes.length, 1);
});

test('uses exit code 2 for invalid CLI configuration', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [binPath, 'inspect', fixturePath, '--wat'], { cwd: repositoryRoot }),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /Unknown option --wat/);
      return true;
    },
  );
});
