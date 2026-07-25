import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safeSegment, resolveInside } from '../core/paths.mjs';
import { RenderproveError } from '../core/errors.mjs';
import { caseStatus } from './diagnostics.mjs';

function shortDigest(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 10);
}

async function fileDigest(filePath) {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

function pushDiagnostic(diagnostics, diagnostic) {
  diagnostics.push({ at: new Date().toISOString(), ...diagnostic });
}

function cancellationError(signal) {
  if (signal?.reason instanceof RenderproveError) return signal.reason;
  return new RenderproveError('Browser review was cancelled.', {
    code: 'REVIEW_CANCELLED',
    cause: signal?.reason instanceof Error ? signal.reason : undefined,
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw cancellationError(signal);
}

export function isSameOrigin(baseUrl, candidateUrl) {
  try {
    return new URL(baseUrl).origin === new URL(candidateUrl).origin;
  } catch {
    return false;
  }
}

export async function runBrowserReview(manifest, {
  baseUrl,
  outputRoot,
  headed = false,
  chromium: chromiumOverride,
  signal,
} = {}) {
  throwIfAborted(signal);
  let chromium = chromiumOverride;
  if (!chromium) {
    try {
      ({ chromium } = await import('playwright'));
    } catch (cause) {
      throw new RenderproveError('Playwright is unavailable. Run npm install and install Chromium.', {
        code: 'PLAYWRIGHT_UNAVAILABLE',
        cause,
      });
    }
  }

  throwIfAborted(signal);
  await fs.mkdir(outputRoot, { recursive: true });
  const browser = await chromium.launch({ headless: !headed });
  const cases = [];
  try {
    throwIfAborted(signal);
    for (const viewport of manifest.review.viewports) {
      for (const route of manifest.review.routes) {
        throwIfAborted(signal);
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: viewport.deviceScaleFactor,
          reducedMotion: 'reduce',
        });
        try {
          cases.push(await reviewCase({ manifest, context, baseUrl, outputRoot, viewport, route, signal }));
        } finally {
          await context.close().catch((error) => {
            if (!signal?.aborted) throw error;
          });
        }
      }
    }
  } finally {
    await browser.close().catch((error) => {
      if (!signal?.aborted) throw error;
    });
  }
  throwIfAborted(signal);
  return cases;
}

async function reviewCase({ manifest, context, baseUrl, outputRoot, viewport, route, signal }) {
  throwIfAborted(signal);
  const page = await context.newPage();
  const diagnostics = [];
  const startedAt = new Date().toISOString();
  const requestedUrl = new URL(route.path, `${baseUrl}/`).toString();
  let fatalFailure = false;
  let result;
  const closeOnAbort = () => {
    void page.close().catch(() => {});
  };
  signal?.addEventListener('abort', closeOnAbort, { once: true });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      pushDiagnostic(diagnostics, { kind: 'console', message: message.text(), location: message.location() });
    }
  });
  page.on('pageerror', (error) => {
    pushDiagnostic(diagnostics, { kind: 'page', message: error.message, stack: error.stack });
  });
  page.on('requestfailed', (request) => {
    pushDiagnostic(diagnostics, {
      kind: 'request',
      message: request.failure()?.errorText ?? 'Request failed',
      method: request.method(),
      url: request.url(),
    });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      pushDiagnostic(diagnostics, {
        kind: 'http',
        message: `HTTP ${response.status()} ${response.statusText()}`,
        url: response.url(),
      });
    }
  });

  try {
    throwIfAborted(signal);
    const response = await page.goto(requestedUrl, {
      waitUntil: 'load',
      timeout: manifest.review.navigationTimeoutMs,
    });
    if (!response?.ok()) fatalFailure = true;
    if (!isSameOrigin(baseUrl, page.url())) {
      throw new RenderproveError(`Main-frame navigation left the declared origin: ${page.url()}`, {
        code: 'CROSS_ORIGIN_NAVIGATION',
      });
    }
    if (route.waitForMs > 0) await page.waitForTimeout(route.waitForMs);
    throwIfAborted(signal);

    const routeDigest = shortDigest(route.path);
    const artifactName = `${safeSegment(viewport.name)}--${safeSegment(route.name, 'root')}--${routeDigest}.png`;
    const screenshotPath = resolveInside(outputRoot, 'screenshots', artifactName);
    await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: route.fullPage });
    throwIfAborted(signal);

    const pageFacts = await page.evaluate(() => ({
      title: document.title,
      lang: document.documentElement.lang || null,
      bodyTextLength: document.body?.innerText?.length ?? 0,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));

    result = {
      id: `${viewport.name}:${route.path}`,
      startedAt,
      finishedAt: new Date().toISOString(),
      route: { name: route.name, path: route.path, requestedUrl, finalUrl: page.url() },
      viewport,
      navigation: { status: response?.status() ?? null, ok: response?.ok() ?? false },
      page: pageFacts,
      artifacts: [{
        kind: 'screenshot',
        path: path.relative(manifest.projectRoot, screenshotPath),
        mimeType: 'image/png',
        sha256: await fileDigest(screenshotPath),
      }],
      diagnostics,
    };
  } catch (error) {
    if (signal?.aborted) throw cancellationError(signal);
    fatalFailure = true;
    pushDiagnostic(diagnostics, { kind: 'page', message: error.message, stack: error.stack });
    result = {
      id: `${viewport.name}:${route.path}`,
      startedAt,
      finishedAt: new Date().toISOString(),
      route: { name: route.name, path: route.path, requestedUrl, finalUrl: page.url() },
      viewport,
      navigation: { status: null, ok: false },
      page: null,
      artifacts: [],
      diagnostics,
    };
  } finally {
    signal?.removeEventListener('abort', closeOnAbort);
    try {
      await page.close();
    } catch (error) {
      if (!signal?.aborted) {
        fatalFailure = true;
        pushDiagnostic(diagnostics, { kind: 'page', message: `Unable to close page: ${error.message}` });
      }
    }
  }

  throwIfAborted(signal);
  result.finishedAt = new Date().toISOString();
  result.status = fatalFailure ? 'failed' : caseStatus(diagnostics, manifest.review.failOn);
  return result;
}
