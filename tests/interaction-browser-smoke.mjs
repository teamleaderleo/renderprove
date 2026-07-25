import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { runInteractionPlan } from '../src/browser/interaction-executor.mjs';

const repoRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const outputRoot = path.join(repoRoot, 'tests', 'fixtures', 'site', '.proof', 'interaction');
await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(outputRoot, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.setContent(`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <style>
          body { font: 16px system-ui; margin: 24px; }
          #surface { width: 480px; height: 220px; background: linear-gradient(135deg, #dde, #efe); touch-action: none; }
          #ready[hidden] { display: none; }
        </style>
      </head>
      <body>
        <button data-testid="open">Open panel</button>
        <p id="ready" hidden>Ready now</p>
        <label>Name <input id="name" value=""></label>
        <label>Choice
          <select data-testid="choice">
            <option value="one">One</option>
            <option value="two">Two</option>
          </select>
        </label>
        <div id="surface" data-down="0" data-move="0" data-up="0">Interaction surface</div>
        <script>
          document.querySelector('[data-testid="open"]').addEventListener('click', () => {
            document.querySelector('#ready').hidden = false;
          });
          const surface = document.querySelector('#surface');
          for (const [eventName, key] of [['pointerdown', 'down'], ['pointermove', 'move'], ['pointerup', 'up']]) {
            surface.addEventListener(eventName, () => {
              surface.dataset[key] = String(Number(surface.dataset[key]) + 1);
            });
          }
        </script>
      </body>
    </html>`);

  const captureDigests = new Map();
  const result = await runInteractionPlan(page, {
    version: 1,
    name: 'chromium-vocabulary',
    defaults: { timeoutMs: 5_000 },
    steps: [
      {
        id: 'move-to-surface',
        type: 'pointerMove',
        to: { space: 'target', target: { by: 'css', value: '#surface' }, x: 0.2, y: 0.5 },
        durationMs: 60,
        steps: 4
      },
      { id: 'open', type: 'click', target: { by: 'role', role: 'button', name: 'Open panel' } },
      { id: 'ready', type: 'waitFor', target: { by: 'text', value: 'Ready now' }, state: 'visible' },
      { id: 'fill-name', type: 'fill', target: { by: 'label', value: 'Name' }, text: 'Ada' },
      { id: 'append-name', type: 'fill', target: { by: 'css', value: '#name' }, text: ' Lovelace', mode: 'append' },
      { id: 'choose', type: 'select', target: { by: 'testId', value: 'choice' }, values: ['two'] },
      {
        id: 'drag-surface',
        type: 'drag',
        from: { space: 'target', target: { by: 'css', value: '#surface' }, x: 0.1, y: 0.5 },
        to: { space: 'target', target: { by: 'css', value: '#surface' }, x: 0.9, y: 0.5 },
        durationMs: 80,
        steps: 5
      },
      { id: 'viewport-move', type: 'pointerMove', to: { space: 'viewport', x: 0.5, y: 0.2 }, durationMs: 0 },
      { id: 'settle', type: 'wait', durationMs: 20 },
      { id: 'capture-surface', type: 'capture', name: 'surface', target: { by: 'css', value: '#surface' }, fullPage: false },
      { id: 'capture-page', type: 'capture', name: 'page', fullPage: true }
    ]
  }, {
    capture: async ({ page: activePage, locator, name, fullPage, timeoutMs }) => {
      const screenshotPath = path.join(outputRoot, `${name}.png`);
      if (locator) await locator.screenshot({ path: screenshotPath, timeout: timeoutMs });
      else await activePage.screenshot({ path: screenshotPath, fullPage, timeout: timeoutMs });
      const digest = createHash('sha256').update(await fs.readFile(screenshotPath)).digest('hex');
      captureDigests.set(name, digest);
    }
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.steps.length, 11);
  assert.equal(await page.locator('#name').inputValue(), 'Ada Lovelace');
  assert.equal(await page.getByTestId('choice').inputValue(), 'two');
  assert.equal(await page.getByText('Ready now').isVisible(), true);
  const pointerCounts = await page.locator('#surface').evaluate((element) => ({
    down: Number(element.dataset.down),
    move: Number(element.dataset.move),
    up: Number(element.dataset.up)
  }));
  assert.equal(pointerCounts.down, 1);
  assert.equal(pointerCounts.up, 1);
  assert.ok(pointerCounts.move >= 4);
  assert.equal(captureDigests.size, 2);
  assert.equal([...captureDigests.values()].every((digest) => digest.length === 64), true);
  assert.equal(JSON.stringify(result).includes('Ada Lovelace'), false);
  assert.equal(JSON.stringify(result).includes('#surface'), false);
  console.log(`Interaction Chromium smoke passed with ${result.steps.length} steps.`);
} finally {
  await browser.close();
}
