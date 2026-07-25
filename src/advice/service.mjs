import fs from 'node:fs/promises';
import path from 'node:path';
import { loadManifest } from '../core/manifest.mjs';
import { resolveInside } from '../core/paths.mjs';
import { buildAdviceBundle } from './bundle.mjs';
import { requestCloudflareAdvice } from './cloudflare.mjs';

export async function adviseProject({
  projectRoot = process.cwd(),
  manifestPath,
  receiptPath,
  outputDir,
  includePaths = [],
  maxFiles,
  maxBytes,
  maxFileBytes,
  model,
  timeoutMs,
  dryRun = false,
  accountId,
  apiToken,
  fetchImpl,
} = {}) {
  const manifest = await loadManifest({ projectRoot, manifestPath });
  const bundle = await buildAdviceBundle({
    projectRoot: manifest.projectRoot,
    manifestPath: manifest.sourcePath,
    receiptPath,
    includePaths,
    maxFiles,
    maxBytes,
    maxFileBytes,
  });
  if (dryRun) return { manifest, bundle, advice: null, advicePath: null };

  const advice = await requestCloudflareAdvice({
    bundle,
    accountId,
    apiToken,
    model,
    timeoutMs,
    fetchImpl,
  });
  const outputRoot = resolveInside(manifest.projectRoot, outputDir ?? manifest.review.outputDir);
  await fs.mkdir(outputRoot, { recursive: true });
  const advicePath = path.join(outputRoot, 'advice.json');
  const temporaryPath = path.join(outputRoot, `.advice-${process.pid}.tmp`);
  await fs.writeFile(temporaryPath, `${JSON.stringify(advice, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, advicePath);
  return { manifest, bundle, advice, advicePath };
}
