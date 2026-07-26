import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import {
  buildComparisonPanels,
  compareRgba,
  deltaEHeatmap,
  reduceDeltaEMax,
} from '../src/visual/delta-e.mjs';
import { comparePngFiles } from '../src/visual/comparison.mjs';
import { decodePng, encodePng } from '../src/visual/png.mjs';
import { parseArgs, runCli } from '../src/cli.mjs';

function solid(width, height, red, green, blue, alpha = 255) {
  const data = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = red;
    data[offset + 1] = green;
    data[offset + 2] = blue;
    data[offset + 3] = alpha;
  }
  return data;
}

function capture() {
  let value = '';
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        value += chunk.toString();
        callback();
      },
    }),
    read: () => value,
  };
}

test('round-trips deterministic RGBA PNG data', () => {
  const width = 3;
  const height = 2;
  const data = new Uint8Array([
    255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0,
    12, 34, 56, 255, 200, 210, 220, 240, 1, 2, 3, 4,
  ]);
  const encoded = encodePng({ width, height, data });
  const decoded = decodePng(encoded);
  assert.equal(decoded.width, width);
  assert.equal(decoded.height, height);
  assert.deepEqual(decoded.data, data);
  assert.deepEqual(encodePng(decoded), encoded);
});

test('reports exact and perceptual tails with declared threshold failures', () => {
  const reference = solid(10, 10, 40, 40, 40);
  const candidate = new Uint8Array(reference);
  for (const offset of [0, 4]) {
    candidate[offset] = 255;
    candidate[offset + 1] = 255;
    candidate[offset + 2] = 255;
  }
  const result = compareRgba(reference, candidate, 10, 10, {
    thresholds: { maxP99DeltaE: 0, maxObviousFraction: 0, maxAlphaError: 0 },
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.metrics.exactChangedPixels, 2);
  assert.equal(result.metrics.exactChangedFraction, 0.02);
  assert.equal(result.metrics.maxDeltaE > 2, true);
  assert.equal(result.metrics.p99DeltaE > 0, true);
  assert.deepEqual(result.failures, ['p99-delta-e', 'obvious-fraction']);
});

test('weights colour error by reference coverage and still reports alpha error', () => {
  const reference = solid(2, 1, 20, 30, 40, 0);
  const candidate = solid(2, 1, 255, 255, 255, 255);
  const result = compareRgba(reference, candidate, 2, 1, {
    thresholds: { maxP99DeltaE: 0, maxObviousFraction: 0, maxAlphaError: 2 },
  });
  assert.equal(result.metrics.visiblePixels, 0);
  assert.equal(result.metrics.meanDeltaE, 0);
  assert.equal(result.metrics.maxDeltaE, 0);
  assert.equal(result.metrics.maxAlphaError, 255);
  assert.deepEqual(result.failures, ['alpha-error']);
});

test('maximum reduction preserves a small severe defect in the difference panel', () => {
  const map = new Float32Array(16);
  map[5] = 9;
  const reduced = reduceDeltaEMax(map, 4, 4, 2, 2);
  assert.deepEqual([...reduced], [9, 0, 0, 0]);
  const heatmap = deltaEHeatmap(reduced);
  assert.deepEqual([...heatmap.slice(0, 4)], [255, 255, 0, 255]);
});

test('never enlarges comparison panels and keeps their semantic order', () => {
  const reference = solid(16, 8, 10, 20, 30);
  const candidate = new Uint8Array(reference);
  const comparison = compareRgba(reference, candidate, 16, 8);
  const panels = buildComparisonPanels(reference, candidate, comparison.deltaEMap, 16, 8, { maxPanelEdge: 128 });
  assert.equal(panels.panelWidth, 16);
  assert.equal(panels.panelHeight, 8);
  assert.equal(panels.triptych.width, 64);
  assert.equal(panels.triptych.height, 8);
});

test('writes byte-deterministic JSON, a full heatmap, and a stable panel digest', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'renderprove-visual-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const referencePath = path.join(root, 'reference.png');
  const candidatePath = path.join(root, 'candidate.png');
  const reference = solid(32, 16, 60, 70, 80);
  const candidate = new Uint8Array(reference);
  candidate[(4 * 32 + 4) * 4] = 180;
  await fs.writeFile(referencePath, encodePng({ width: 32, height: 16, data: reference }));
  await fs.writeFile(candidatePath, encodePng({ width: 32, height: 16, data: candidate }));
  const first = await comparePngFiles({
    referencePath: 'reference.png',
    candidatePath: 'candidate.png',
    outputDir: 'first',
    cwd: root,
    thresholds: { maxP99DeltaE: 200, maxObviousFraction: 1, maxAlphaError: 255 },
  });
  const second = await comparePngFiles({
    referencePath: 'reference.png',
    candidatePath: 'candidate.png',
    outputDir: 'second',
    cwd: root,
    thresholds: { maxP99DeltaE: 200, maxObviousFraction: 1, maxAlphaError: 255 },
  });
  assert.equal(first.result.version, 1);
  assert.equal(first.result.deterministic, true);
  assert.equal('generatedAt' in first.result, false);
  assert.equal(first.result.status, 'passed');
  assert.equal(first.result.images.reference.path, 'reference.png');
  assert.equal(first.result.metrics.exactChangedPixels, 1);
  assert.equal(first.result.artifacts.panelsSha256, second.result.artifacts.panelsSha256);
  assert.deepEqual(await fs.readFile(first.resultPath), await fs.readFile(second.resultPath));
  assert.equal((await fs.stat(first.differencePath)).isFile(), true);
  assert.equal((await fs.stat(first.comparisonPath)).isFile(), true);
  const difference = decodePng(await fs.readFile(first.differencePath));
  const triptych = decodePng(await fs.readFile(first.comparisonPath));
  assert.deepEqual({ width: difference.width, height: difference.height }, { width: 32, height: 16 });
  assert.equal(triptych.width, 32 * 3 + 16);
  assert.equal(triptych.height, 16);
});

test('parses and runs the compare CLI with a failing threshold exit code', async (t) => {
  assert.deepEqual(parseArgs([
    'compare', 'before.png', 'after.png', '--output', 'proof', '--max-p99-delta-e', '0.5',
    '--max-obvious-fraction', '0.01', '--max-alpha-error', '4', '--max-panel-edge', '512', '--json',
  ]), {
    command: 'compare',
    projectRoot: '.',
    json: true,
    headed: false,
    referencePath: 'before.png',
    candidatePath: 'after.png',
    output: 'proof',
    maxP99DeltaE: 0.5,
    maxObviousFraction: 0.01,
    maxAlphaError: 4,
    maxPanelEdge: 512,
  });
  assert.throws(
    () => parseArgs(['compare', 'before.png', 'after.png', 'third.png']),
    /Unexpected argument third\.png/,
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'renderprove-visual-cli-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'before.png'), encodePng({ width: 2, height: 2, data: solid(2, 2, 0, 0, 0) }));
  await fs.writeFile(path.join(root, 'after.png'), encodePng({ width: 2, height: 2, data: solid(2, 2, 255, 255, 255) }));
  const stdout = capture();
  const stderr = capture();
  const code = await runCli([
    'compare', 'before.png', 'after.png', '--output', 'proof', '--max-p99-delta-e', '0', '--json',
  ], { stdout: stdout.stream, stderr: stderr.stream, cwd: root, env: {} });
  assert.equal(code, 1);
  assert.equal(stderr.read(), '');
  const result = JSON.parse(stdout.read());
  assert.equal(result.status, 'failed');
  assert.equal(result.failures.includes('p99-delta-e'), true);
});
