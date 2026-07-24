import fs from 'node:fs/promises';
import path from 'node:path';
import { loadManifest } from './core/manifest.mjs';
import { createReceipt } from './core/receipt.mjs';
import { resolveInside } from './core/paths.mjs';
import { startRuntime } from './runtime/process.mjs';
import { runBrowserReview } from './browser/review.mjs';

export async function inspectProject(options = {}) {
  return loadManifest(options);
}

export async function reviewProject({ projectRoot = process.cwd(), manifestPath, outputDir, headed = false, chromium, signal } = {}) {
  const manifest = await loadManifest({ projectRoot, manifestPath });
  const outputRoot = resolveInside(manifest.projectRoot, outputDir ?? manifest.review.outputDir);
  const startedAt = new Date().toISOString();
  const runtime = await startRuntime(manifest, { signal });
  let cases;
  let runtimeLogs = null;
  try {
    cases = await runBrowserReview(manifest, {
      baseUrl: runtime.baseUrl,
      outputRoot,
      headed,
      chromium,
    });
  } finally {
    await runtime.stop();
    runtimeLogs = runtime.logs?.() ?? null;
  }
  const finishedAt = new Date().toISOString();
  const receipt = createReceipt({
    manifest,
    startedAt,
    finishedAt,
    baseUrl: runtime.baseUrl,
    cases,
    runtime: { ...runtime.details, logs: runtimeLogs },
  });
  await fs.mkdir(outputRoot, { recursive: true });
  const receiptPath = path.join(outputRoot, 'receipt.json');
  await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { manifest, receipt, receiptPath };
}
