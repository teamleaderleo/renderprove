import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveProbePaths } from '../src/probe/enrollment.mjs';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'renderprove-enrollment-'));
  const toolRoot = path.join(root, 'tool');
  const enrolledRoot = path.join(root, 'projects');
  const projectRoot = path.join(enrolledRoot, 'app');
  const outside = path.join(root, 'outside');
  await Promise.all([
    fs.mkdir(toolRoot, { recursive: true }),
    fs.mkdir(projectRoot, { recursive: true }),
    fs.mkdir(outside, { recursive: true }),
  ]);
  return { root, toolRoot, enrolledRoot, projectRoot, outside };
}

test('defaults enrolment to the tool root', async (t) => {
  const paths = await fixture();
  t.after(() => fs.rm(paths.root, { recursive: true, force: true }));
  const project = path.join(paths.toolRoot, 'fixture');
  await fs.mkdir(project);

  const result = await resolveProbePaths({
    toolRoot: paths.toolRoot,
    project: 'fixture',
    output: '.renderprove-probe',
  });

  assert.equal(result.enrolledRoot, paths.toolRoot);
  assert.equal(result.projectRoot, project);
  assert.equal(result.evidenceRoot, path.join(project, '.renderprove-probe'));
  assert.equal(result.containerOutput, '.renderprove-probe');
});

test('accepts a project beneath an explicit external enrolment root', async (t) => {
  const paths = await fixture();
  t.after(() => fs.rm(paths.root, { recursive: true, force: true }));

  const result = await resolveProbePaths({
    toolRoot: paths.toolRoot,
    enrolledRoot: paths.enrolledRoot,
    project: 'app',
    output: '.proof/runs/001',
  });

  assert.equal(result.enrolledRoot, paths.enrolledRoot);
  assert.equal(result.projectRoot, paths.projectRoot);
  assert.equal(result.containerOutput, path.join('.proof', 'runs', '001'));
});

test('rejects lexical and symlink escapes from the enrolment root', async (t) => {
  const paths = await fixture();
  t.after(() => fs.rm(paths.root, { recursive: true, force: true }));

  await assert.rejects(
    resolveProbePaths({
      toolRoot: paths.toolRoot,
      enrolledRoot: paths.enrolledRoot,
      project: paths.outside,
      output: '.proof',
    }),
    /project must stay inside the enrolled root/,
  );

  const link = path.join(paths.enrolledRoot, 'escape');
  await fs.symlink(paths.outside, link);
  await assert.rejects(
    resolveProbePaths({
      toolRoot: paths.toolRoot,
      enrolledRoot: paths.enrolledRoot,
      project: 'escape',
      output: '.proof',
    }),
    /project must stay inside the enrolled root/,
  );
});

test('rejects evidence traversal and symlinked output escapes', async (t) => {
  const paths = await fixture();
  t.after(() => fs.rm(paths.root, { recursive: true, force: true }));

  await assert.rejects(
    resolveProbePaths({
      toolRoot: paths.toolRoot,
      enrolledRoot: paths.enrolledRoot,
      project: 'app',
      output: '../outside',
    }),
    /evidence output must stay inside the project/,
  );

  await fs.symlink(paths.outside, path.join(paths.projectRoot, '.proof'));
  await assert.rejects(
    resolveProbePaths({
      toolRoot: paths.toolRoot,
      enrolledRoot: paths.enrolledRoot,
      project: 'app',
      output: '.proof/runs/001',
    }),
    /evidence output must stay inside the project/,
  );
});
