import fs from 'node:fs/promises';
import path from 'node:path';
import { loadManifest } from '../core/manifest.mjs';
import { resolveInside } from '../core/paths.mjs';
import { RenderproveError } from '../core/errors.mjs';
import { buildAdviceBundle } from './bundle.mjs';
import { DEFAULT_CLOUDFLARE_MODEL, requestCloudflareAdvice } from './cloudflare.mjs';
import {
  adviceBudgetDecision,
  applyAdvicePolicy,
  loadAdvicePolicy,
} from './policy.mjs';

async function writeJsonAtomic(targetPath, value) {
  const temporaryPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}-${process.pid}.tmp`);
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, targetPath);
}

async function readReusableAdvice(advicePath, bundle) {
  try {
    const parsed = JSON.parse(await fs.readFile(advicePath, 'utf8'));
    if (parsed?.version !== 1 || parsed?.authoritative !== false) return null;
    if (parsed?.input?.sha256 !== bundle.sha256) return null;
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

function statusRecord(status, bundle, extras = {}) {
  return {
    version: 1,
    status,
    authoritative: false,
    bundleSha256: bundle.sha256,
    budget: bundle.budget,
    generation: bundle.generationPolicy,
    ...extras,
  };
}

function providerDiagnostic(error) {
  if (!(error instanceof RenderproveError) || !error.details || typeof error.details !== 'object') return null;
  const details = error.details;
  const usage = details.usage && typeof details.usage === 'object'
    ? Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens']
      .filter((key) => Number.isFinite(details.usage[key]) && details.usage[key] >= 0)
      .map((key) => [key, details.usage[key]]))
    : null;
  const diagnostic = {
    finishReason: typeof details.finishReason === 'string' ? details.finishReason.slice(0, 80) : null,
    toolCalls: Number.isInteger(details.toolCalls) && details.toolCalls >= 0 ? details.toolCalls : null,
    contentChars: Number.isInteger(details.contentChars) && details.contentChars >= 0 ? details.contentChars : null,
    usage: usage && Object.keys(usage).length > 0 ? usage : null,
  };
  return Object.values(diagnostic).some((value) => value != null) ? diagnostic : null;
}

export async function adviseProject({
  projectRoot = process.cwd(),
  manifestPath,
  adviceConfigPath,
  receiptPath,
  outputDir,
  includePaths,
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
  const policy = await loadAdvicePolicy({
    projectRoot: manifest.projectRoot,
    configPath: adviceConfigPath,
  });
  const effectiveModel = model ?? policy.model ?? DEFAULT_CLOUDFLARE_MODEL;
  const selectedIncludes = Array.isArray(includePaths) && includePaths.length > 0
    ? includePaths
    : policy.includePaths;
  const rawBundle = await buildAdviceBundle({
    projectRoot: manifest.projectRoot,
    manifestPath: manifest.sourcePath,
    receiptPath,
    includePaths: selectedIncludes,
    maxFiles: maxFiles ?? policy.limits.maxFiles,
    maxBytes: maxBytes ?? policy.limits.maxBytes,
    maxFileBytes: maxFileBytes ?? policy.limits.maxFileBytes,
  });
  const bundle = applyAdvicePolicy(rawBundle, policy, { model: effectiveModel });
  if (dryRun) {
    return {
      manifest,
      policy,
      bundle,
      budget: adviceBudgetDecision(bundle),
      advice: null,
      advicePath: null,
      status: null,
      statusPath: null,
      reused: false,
    };
  }

  const outputRoot = resolveInside(manifest.projectRoot, outputDir ?? manifest.review.outputDir);
  await fs.mkdir(outputRoot, { recursive: true });
  const advicePath = path.join(outputRoot, 'advice.json');
  const statusPath = path.join(outputRoot, 'advice-status.json');
  const budget = adviceBudgetDecision(bundle);
  if (!budget.allowed) {
    const status = statusRecord('skipped', bundle, {
      reason: budget.reason,
      contact: budget.contact,
    });
    await writeJsonAtomic(statusPath, status);
    if (budget.onExceed === 'error') {
      const contact = budget.contact ? ` Contact ${budget.contact} before increasing the budget.` : '';
      throw new RenderproveError(
        `Estimated advisory use is ${budget.estimatedNeurons} Neurons, above the per-run ceiling of ${budget.maxEstimatedNeurons}.${contact}`,
        { code: 'ADVICE_BUDGET_EXCEEDED', details: status },
      );
    }
    return {
      manifest,
      policy,
      bundle,
      budget,
      advice: null,
      advicePath: null,
      status,
      statusPath,
      reused: false,
    };
  }

  if (policy.cache.reuse) {
    const cached = await readReusableAdvice(advicePath, bundle);
    if (cached) {
      const status = statusRecord('available', bundle, { reused: true });
      await writeJsonAtomic(statusPath, status);
      return {
        manifest,
        policy,
        bundle,
        budget,
        advice: cached,
        advicePath,
        status,
        statusPath,
        reused: true,
      };
    }
  }

  let advice;
  try {
    advice = await requestCloudflareAdvice({
      bundle,
      accountId,
      apiToken,
      model: effectiveModel,
      timeoutMs: timeoutMs ?? policy.limits.timeoutMs ?? undefined,
      generation: policy.generation,
      fetchImpl,
    });
  } catch (error) {
    const status = statusRecord('unavailable', bundle, {
      reason: error instanceof RenderproveError ? error.code : 'UNEXPECTED_ADVICE_FAILURE',
      diagnostic: providerDiagnostic(error),
    });
    await writeJsonAtomic(statusPath, status);
    throw error;
  }
  await writeJsonAtomic(advicePath, advice);
  const status = statusRecord('available', bundle, { reused: false });
  await writeJsonAtomic(statusPath, status);
  return {
    manifest,
    policy,
    bundle,
    budget,
    advice,
    advicePath,
    status,
    statusPath,
    reused: false,
  };
}
