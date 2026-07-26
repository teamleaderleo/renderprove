import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RenderproveError } from '../core/errors.mjs';
import {
  DEFAULT_ADVICE_GENERATION,
  normalizeAdviceGeneration,
} from './generation.mjs';

export const DEFAULT_ADVICE_CONFIG_NAMES = ['renderprove-advice.json', '.renderprove-advice.json'];
export const DEFAULT_DAILY_NEURONS = 10_000;
export const DEFAULT_MAX_ESTIMATED_NEURONS = 1_000;
export const DEFAULT_MAX_COMPLETION_TOKENS = DEFAULT_ADVICE_GENERATION.maxCompletionTokens;

const DEFAULT_LOCKFILE_PATTERNS = Object.freeze([
  '**/package-lock.json',
  '**/npm-shrinkwrap.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
  '**/bun.lock',
  '**/bun.lockb',
  '**/Cargo.lock',
  '**/go.sum',
  '**/Gemfile.lock',
  '**/Podfile.lock',
  '**/composer.lock',
]);

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RenderproveError(`${label} must be an object.`, { code: 'INVALID_ADVICE_CONFIG' });
  }
  return value;
}

function assertKnownKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new RenderproveError(`${label} contains unknown fields: ${unknown.join(', ')}.`, {
      code: 'INVALID_ADVICE_CONFIG',
      details: { unknown },
    });
  }
}

function normalizeInteger(value, fallback, label, { min, max }) {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate < min || candidate > max) {
    throw new RenderproveError(`${label} must be an integer between ${min} and ${max}.`, {
      code: 'INVALID_ADVICE_CONFIG',
    });
  }
  return candidate;
}

function normalizeStringList(value, label, { maxItems, maxLength }) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new RenderproveError(`${label} must be an array with at most ${maxItems} entries.`, {
      code: 'INVALID_ADVICE_CONFIG',
    });
  }
  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim().length === 0 || item.trim().length > maxLength) {
      throw new RenderproveError(`${label}[${index}] must be a non-empty string up to ${maxLength} characters.`, {
        code: 'INVALID_ADVICE_CONFIG',
      });
    }
    return item.trim();
  });
}

function normalizeProjectPath(value, label, { allowGlob = false } = {}) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) {
    throw new RenderproveError(`${label} must be a non-empty project-relative path.`, {
      code: 'INVALID_ADVICE_CONFIG',
    });
  }
  const normalized = value.trim().replaceAll('\\', '/').replace(/^\.\//, '');
  if (path.posix.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new RenderproveError(`${label} must stay inside the project root.`, {
      code: 'INVALID_ADVICE_CONFIG',
    });
  }
  if (!allowGlob && /[*?\[\]]/.test(normalized)) {
    throw new RenderproveError(`${label} must name a concrete file or directory.`, {
      code: 'INVALID_ADVICE_CONFIG',
    });
  }
  return normalized;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function resolveConfigPath(projectRoot, explicitPath) {
  const root = await fs.realpath(path.resolve(projectRoot));
  const candidates = explicitPath ? [explicitPath] : DEFAULT_ADVICE_CONFIG_NAMES;
  for (const requested of candidates) {
    const lexical = path.resolve(root, requested);
    if (!isInside(root, lexical)) {
      throw new RenderproveError('Advice config path must stay inside the project root.', {
        code: 'UNSAFE_ADVICE_CONFIG_PATH',
      });
    }
    let stat;
    try {
      stat = await fs.lstat(lexical);
    } catch (error) {
      if (error?.code === 'ENOENT' && !explicitPath) continue;
      if (error?.code === 'ENOENT') {
        throw new RenderproveError('Advice config does not exist.', { code: 'ADVICE_CONFIG_NOT_FOUND', cause: error });
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new RenderproveError('Advice config must not be a symbolic link.', {
        code: 'UNSAFE_ADVICE_CONFIG_PATH',
      });
    }
    const real = await fs.realpath(lexical);
    if (!isInside(root, real)) {
      throw new RenderproveError('Advice config resolves outside the project root.', {
        code: 'UNSAFE_ADVICE_CONFIG_PATH',
      });
    }
    return { root, sourcePath: real };
  }
  return { root, sourcePath: null };
}

export function normalizeAdvicePolicy(input = {}, { projectRoot = process.cwd(), sourcePath = null } = {}) {
  assertObject(input, 'advice config');
  assertKnownKeys(input, [
    '$schema', 'version', 'mode', 'model', 'questions', 'include', 'exclude', 'includeLockfiles',
    'limits', 'generation', 'budget', 'cache',
  ], 'advice config');
  if (input.version != null && input.version !== 1) {
    throw new RenderproveError('advice config version must be 1.', { code: 'UNSUPPORTED_ADVICE_CONFIG_VERSION' });
  }
  const mode = input.mode ?? 'targeted';
  if (!['targeted', 'explore'].includes(mode)) {
    throw new RenderproveError('advice config mode must be targeted or explore.', {
      code: 'INVALID_ADVICE_CONFIG',
    });
  }
  if (input.model != null && (typeof input.model !== 'string' || !/^@[A-Za-z0-9._/-]{3,200}$/.test(input.model))) {
    throw new RenderproveError('advice config model must be a valid @provider/model identifier.', {
      code: 'INVALID_ADVICE_CONFIG',
    });
  }
  if (input.includeLockfiles != null && typeof input.includeLockfiles !== 'boolean') {
    throw new RenderproveError('advice config includeLockfiles must be a boolean.', {
      code: 'INVALID_ADVICE_CONFIG',
    });
  }
  const includePaths = normalizeStringList(input.include, 'advice config include', { maxItems: 64, maxLength: 500 })
    .map((item, index) => normalizeProjectPath(item, `advice config include[${index}]`));
  const configuredExcludes = normalizeStringList(input.exclude, 'advice config exclude', { maxItems: 128, maxLength: 500 })
    .map((item, index) => normalizeProjectPath(item, `advice config exclude[${index}]`, { allowGlob: true }));
  const limitsInput = input.limits ?? {};
  assertObject(limitsInput, 'advice config limits');
  assertKnownKeys(limitsInput, ['maxFiles', 'maxBytes', 'maxFileBytes', 'timeoutMs'], 'advice config limits');
  const generation = normalizeAdviceGeneration(input.generation ?? {}, {
    code: 'INVALID_ADVICE_CONFIG',
    label: 'advice config generation',
  });
  const budgetInput = input.budget ?? {};
  assertObject(budgetInput, 'advice config budget');
  assertKnownKeys(budgetInput, ['dailyNeurons', 'maxEstimatedNeurons', 'onExceed', 'contact'], 'advice config budget');
  const dailyNeurons = normalizeInteger(
    budgetInput.dailyNeurons,
    DEFAULT_DAILY_NEURONS,
    'advice config budget.dailyNeurons',
    { min: 1, max: 10_000_000 },
  );
  const maxEstimatedNeurons = normalizeInteger(
    budgetInput.maxEstimatedNeurons,
    Math.min(DEFAULT_MAX_ESTIMATED_NEURONS, dailyNeurons),
    'advice config budget.maxEstimatedNeurons',
    { min: 1, max: dailyNeurons },
  );
  const onExceed = budgetInput.onExceed ?? 'skip';
  if (!['skip', 'error'].includes(onExceed)) {
    throw new RenderproveError('advice config budget.onExceed must be skip or error.', {
      code: 'INVALID_ADVICE_CONFIG',
    });
  }
  const contact = budgetInput.contact == null ? null : String(budgetInput.contact).trim();
  if (contact != null && (contact.length === 0 || contact.length > 100)) {
    throw new RenderproveError('advice config budget.contact must be a non-empty string up to 100 characters.', {
      code: 'INVALID_ADVICE_CONFIG',
    });
  }
  const cacheInput = input.cache ?? {};
  assertObject(cacheInput, 'advice config cache');
  assertKnownKeys(cacheInput, ['reuse'], 'advice config cache');
  if (cacheInput.reuse != null && typeof cacheInput.reuse !== 'boolean') {
    throw new RenderproveError('advice config cache.reuse must be a boolean.', {
      code: 'INVALID_ADVICE_CONFIG',
    });
  }
  const excludePatterns = input.includeLockfiles === true
    ? configuredExcludes
    : [...DEFAULT_LOCKFILE_PATTERNS, ...configuredExcludes];
  return Object.freeze({
    version: 1,
    sourcePath,
    source: sourcePath ? path.relative(path.resolve(projectRoot), sourcePath).split(path.sep).join('/') : null,
    mode,
    model: input.model ?? null,
    questions: normalizeStringList(input.questions, 'advice config questions', { maxItems: 12, maxLength: 500 }),
    includePaths,
    excludePatterns,
    includeLockfiles: input.includeLockfiles === true,
    limits: Object.freeze({
      maxFiles: limitsInput.maxFiles == null ? null : normalizeInteger(limitsInput.maxFiles, null, 'advice config limits.maxFiles', { min: 1, max: 256 }),
      maxBytes: limitsInput.maxBytes == null ? null : normalizeInteger(limitsInput.maxBytes, null, 'advice config limits.maxBytes', { min: 1_024, max: 4_000_000 }),
      maxFileBytes: limitsInput.maxFileBytes == null ? null : normalizeInteger(limitsInput.maxFileBytes, null, 'advice config limits.maxFileBytes', { min: 1_024, max: 1_000_000 }),
      timeoutMs: limitsInput.timeoutMs == null ? null : normalizeInteger(limitsInput.timeoutMs, null, 'advice config limits.timeoutMs', { min: 1_000, max: 120_000 }),
    }),
    generation,
    budget: Object.freeze({ dailyNeurons, maxEstimatedNeurons, onExceed, contact }),
    cache: Object.freeze({ reuse: cacheInput.reuse ?? true }),
  });
}

export async function loadAdvicePolicy({ projectRoot = process.cwd(), configPath } = {}) {
  const resolved = await resolveConfigPath(projectRoot, configPath);
  if (!resolved.sourcePath) return normalizeAdvicePolicy({}, { projectRoot: resolved.root, sourcePath: null });
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(resolved.sourcePath, 'utf8'));
  } catch (cause) {
    throw new RenderproveError(`Unable to parse ${resolved.sourcePath} as JSON.`, {
      code: 'INVALID_ADVICE_CONFIG_JSON',
      cause,
    });
  }
  return normalizeAdvicePolicy(parsed, { projectRoot: resolved.root, sourcePath: resolved.sourcePath });
}

function globToRegExp(pattern) {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*';
        index += 1;
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`);
}

export function matchesAdviceExclude(filePath, patterns) {
  const normalized = filePath.replaceAll('\\', '/').replace(/^\.\//, '');
  return patterns.some((pattern) => {
    if (pattern.startsWith('**/') && normalized === pattern.slice(3)) return true;
    return globToRegExp(pattern).test(normalized);
  });
}

function policyEvidence(policy, { model }) {
  return {
    version: 1,
    source: policy.source,
    mode: policy.mode,
    model,
    questions: policy.questions,
    include: policy.includePaths,
    exclude: policy.excludePatterns,
    includeLockfiles: policy.includeLockfiles,
    limits: policy.limits,
    generation: policy.generation,
    budget: policy.budget,
    cache: policy.cache,
  };
}

function digestBundle(project, files) {
  return crypto.createHash('sha256').update(JSON.stringify({
    version: 1,
    project,
    files: files.map(({ path: filePath, bytes, sha256, redactions, content }) => ({
      path: filePath,
      bytes,
      sha256,
      redactions,
      content,
    })),
  })).digest('hex');
}

export function estimateAdviceNeurons(bundle, {
  maxCompletionTokens = bundle?.generationPolicy?.maxCompletionTokens ?? DEFAULT_MAX_COMPLETION_TOKENS,
} = {}) {
  const estimatedInputTokens = Math.ceil(bundle.summary.bytes / 2) + 2_000;
  const estimatedOutputTokens = maxCompletionTokens;
  const inputNeurons = estimatedInputTokens * 9_091 / 1_000_000;
  const outputNeurons = estimatedOutputTokens * 27_273 / 1_000_000;
  return Object.freeze({
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedNeurons: Math.ceil(inputNeurons + outputNeurons),
  });
}

export function applyAdvicePolicy(bundle, policy, { model } = {}) {
  const mandatory = new Set([bundle.manifest, bundle.receipt].filter(Boolean));
  const omissions = [...bundle.omissions];
  const files = bundle.files.filter((file) => {
    if (mandatory.has(file.path)) return true;
    if (!matchesAdviceExclude(file.path, policy.excludePatterns)) return true;
    omissions.push({ path: file.path, reason: 'policy-exclude', bytes: file.bytes });
    return false;
  });
  const content = `${JSON.stringify(policyEvidence(policy, { model }), null, 2)}\n`;
  const virtual = {
    path: '.renderprove/advice-policy.generated.json',
    bytes: Buffer.byteLength(content),
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
    redactions: 0,
    content,
  };
  while (files.length >= bundle.limits.maxFiles) {
    const index = files.findLastIndex((file) => !mandatory.has(file.path));
    if (index < 0) {
      throw new RenderproveError('Advice policy needs one file slot beyond the mandatory manifest and receipt.', {
        code: 'ADVICE_POLICY_LIMIT_EXCEEDED',
      });
    }
    const [removed] = files.splice(index, 1);
    omissions.push({ path: removed.path, reason: 'policy-reserved-slot', bytes: removed.bytes });
  }
  let bytes = files.reduce((total, file) => total + file.bytes, 0);
  while (bytes + virtual.bytes > bundle.limits.maxBytes) {
    const index = files.findLastIndex((file) => !mandatory.has(file.path));
    if (index < 0) {
      throw new RenderproveError('Advice policy exceeds the configured byte limit.', {
        code: 'ADVICE_POLICY_LIMIT_EXCEEDED',
      });
    }
    const [removed] = files.splice(index, 1);
    bytes -= removed.bytes;
    omissions.push({ path: removed.path, reason: 'policy-reserved-bytes', bytes: removed.bytes });
  }
  files.push(virtual);
  bytes += virtual.bytes;
  const redactions = files.reduce((total, file) => total + file.redactions, 0);
  const withPolicy = {
    ...bundle,
    sha256: digestBundle(bundle.project, files),
    summary: { files: files.length, bytes, redactions, omissions: omissions.length },
    files,
    omissions,
    mode: policy.mode,
    reviewQuestions: policy.questions,
    policySource: policy.source,
    generationPolicy: policy.generation,
  };
  const estimate = estimateAdviceNeurons(withPolicy);
  return Object.freeze({
    ...withPolicy,
    budget: Object.freeze({ ...policy.budget, ...estimate }),
  });
}

export function adviceBudgetDecision(bundle) {
  const budget = bundle.budget;
  if (budget.estimatedNeurons <= budget.maxEstimatedNeurons) {
    return Object.freeze({ allowed: true, reason: null, ...budget });
  }
  return Object.freeze({ allowed: false, reason: 'estimated-neuron-budget', ...budget });
}
