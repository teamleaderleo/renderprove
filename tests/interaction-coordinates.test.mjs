import test from 'node:test';
import assert from 'node:assert/strict';
import { runInteractionPlan } from '../src/browser/interaction-executor.mjs';

function pointPlan(steps) {
  return {
    version: 1,
    name: 'coordinate-boundaries',
    defaults: { timeoutMs: 1_000 },
    steps,
  };
}

function fakePage() {
  const moves = [];
  const locator = {
    async waitFor() {},
    async scrollIntoViewIfNeeded() {},
    async boundingBox() { return { x: 100, y: 50, width: 200, height: 100 }; },
  };
  return {
    moves,
    viewportSize() { return { width: 1_000, height: 800 }; },
    locator() { return locator; },
    mouse: {
      async move(x, y) { moves.push([x, y]); },
    },
  };
}

test('maps normalized viewport and target endpoints to interior pixel centres', async () => {
  const page = fakePage();
  await runInteractionPlan(page, pointPlan([
    { id: 'viewport-start', type: 'pointerMove', to: { space: 'viewport', x: 0, y: 0 }, durationMs: 0 },
    { id: 'viewport-end', type: 'pointerMove', to: { space: 'viewport', x: 1, y: 1 }, durationMs: 0 },
    {
      id: 'target-start',
      type: 'pointerMove',
      to: { space: 'target', target: { by: 'css', value: '#surface' }, x: 0, y: 0 },
      durationMs: 0,
    },
    {
      id: 'target-end',
      type: 'pointerMove',
      to: { space: 'target', target: { by: 'css', value: '#surface' }, x: 1, y: 1 },
      durationMs: 0,
    },
  ]));

  assert.deepEqual(page.moves, [
    [0.5, 0.5],
    [999.5, 799.5],
    [100.5, 50.5],
    [299.5, 149.5],
  ]);
});
