import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runBrowserReview } from '../src/browser/review.mjs';
import { reviewProject } from '../src/service.mjs';

const reviewConfig = {
  routes: [{ path: '/', name: '/', waitForMs: 0, fullPage: true }],
  viewports: [{ name: 'desktop', width: 800, height: 600, deviceScaleFactor: 1 }],
  failOn: { consoleError: true, pageError: true, requestFailure: true, httpError: true },
  outputDir: '.renderprove',
  navigationTimeoutMs: 30_000,
};

test('pre-aborted browser reviews reject before launching Chromium', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancel before launch'));
  let launched = false;
  await assert.rejects(
    runBrowserReview(
      { projectRoot: '/tmp/project', review: reviewConfig },
      {
        baseUrl: 'https://example.com',
        outputRoot: '/tmp/project/.renderprove',
        signal: controller.signal,
        chromium: {
          async launch() {
            launched = true;
            throw new Error('launch should not run');
          },
        },
      },
    ),
    (error) => error.code === 'REVIEW_CANCELLED',
  );
  assert.equal(launched, false);
});

test('cancellation closes page, context, browser, runtime path, and skips the receipt', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'renderprove-cancel-'));
  const receiptPath = path.join(projectRoot, '.renderprove', 'receipt.json');
  await fs.writeFile(path.join(projectRoot, 'renderprove.json'), `${JSON.stringify({
    version: 1,
    project: 'cancel-fixture',
    target: { baseUrl: 'https://example.com' },
    review: {
      routes: ['/'],
      viewports: ['desktop'],
      outputDir: '.renderprove',
    },
  }, null, 2)}\n`);

  let resolveGotoStarted;
  const gotoStarted = new Promise((resolve) => { resolveGotoStarted = resolve; });
  let rejectNavigation;
  let pageClosed = false;
  let contextClosed = false;
  let browserClosed = false;
  const page = {
    on() {},
    url() { return 'https://example.com/'; },
    goto() {
      resolveGotoStarted();
      return new Promise((resolve, reject) => {
        rejectNavigation = reject;
      });
    },
    async close() {
      if (pageClosed) return;
      pageClosed = true;
      rejectNavigation?.(new Error('page closed'));
    },
  };
  const context = {
    async newPage() { return page; },
    async close() { contextClosed = true; },
  };
  const browser = {
    async newContext() { return context; },
    async close() { browserClosed = true; },
  };
  const chromium = {
    async launch() { return browser; },
  };
  const controller = new AbortController();

  try {
    const pending = reviewProject({
      projectRoot,
      chromium,
      signal: controller.signal,
    });
    await gotoStarted;
    controller.abort(new Error('client cancelled'));
    await assert.rejects(pending, (error) => error.code === 'REVIEW_CANCELLED');
    assert.equal(pageClosed, true);
    assert.equal(contextClosed, true);
    assert.equal(browserClosed, true);
    await assert.rejects(fs.access(receiptPath), (error) => error.code === 'ENOENT');
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
