import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { loadManifest } from '../core/manifest.mjs';
import { RenderproveError } from '../core/errors.mjs';

const DEFAULT_MAX_FILES = 64;
const DEFAULT_MAX_BYTES = 400_000;
const DEFAULT_MAX_FILE_BYTES = 96_000;
const TEXT_EXTENSIONS = new Set([
  '.astro', '.c', '.cc', '.cjs', '.cpp', '.css', '.go', '.gql', '.graphql', '.h', '.hpp', '.html',
  '.java', '.js', '.json', '.jsonc', '.jsx', '.kt', '.kts', '.md', '.mdx', '.mjs', '.mod', '.php',
  '.prisma', '.proto', '.py', '.rb', '.rs', '.scss', '.sh', '.sql', '.sum', '.svelte', '.swift', '.toml',
  '.ts', '.tsx', '.txt', '.vue', '.xml', '.yaml', '.yml',
]);
const TEXT_BASENAMES = new Set([
  '.dockerignore', '.editorconfig', '.gitignore', '.npmignore', '.prettierignore', '.prettierrc',
  'Cargo.lock', 'Containerfile', 'Dockerfile', 'Gemfile', 'LICENSE', 'Makefile', 'Procfile', 'README',
  'SECURITY', 'go.mod', 'go.sum',
]);
const DEFAULT_EXCLUDED_DIRECTORIES = new Set([
  '.git', '.next', '.nuxt', '.parcel-cache', '.renderprove', '.renderprove-ci', '.renderprove-probe',
  '.renderprove-repeatability', '.turbo', '.venv', 'build', 'coverage', 'dist', 'node_modules', 'out',
  'playwright-report', 'target', 'test-results', 'vendor',
]);
const SENSITIVE_NAME = /(^|[._-])(credential|credentials|secret|secrets|token|tokens|password|passwd|private|id_rsa|id_ed25519)([._-]|$)|(^|\/)\.env($|\.)|\.(?:key|pem|p12|pfx)$/i;
const UTF8 = new TextDecoder('utf-8', { fatal: true });

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizeLimit(value, fallback, label, { min, max }) {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate < min || candidate > max) {
    throw new RenderproveError(`${label} must be an integer between ${min} and ${max}.`, {
      code: 'INVALID_ADVICE_ARGUMENT',
    });
  }
  return candidate;
}

function toProjectPath(projectRoot, absolutePath) {
  return path.relative(projectRoot, absolutePath).split(path.sep).join('/');
}

function isTextPath(filePath) {
  const base = path.basename(filePath);
  return TEXT_BASENAMES.has(base) || TEXT_EXTENSIONS.has(path.extname(base).toLowerCase());
}

function redactSecrets(input) {
  let redactions = 0;
  const replace = (replacement) => () => {
    redactions += 1;
    return replacement;
  };
  let content = input.replace(
    /-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/g,
    replace('[REDACTED PRIVATE KEY]'),
  );
  content = content.replace(
    /((?:"|'|\b)?(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|client[_-]?secret)(?:"|'|\b)?\s*[:=]\s*)(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;}]+)/gi,
    (match, prefix) => {
      redactions += 1;
      return `${prefix}"[REDACTED]"`;
    },
  );
  content = content.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, replace('Bearer [REDACTED]'));
  content = content.replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replace('[REDACTED GITHUB TOKEN]'));
  content = content.replace(/https?:\/\/[^\s/@:]+:[^\s/@]+@/g, (match) => {
    redactions += 1;
    return `${match.startsWith('https:') ? 'https' : 'http'}://[REDACTED]@`;
  });
  return { content, redactions };
}

async function existingRealPath(projectRoot, requestedPath, label) {
  const absolute = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(projectRoot, requestedPath);
  if (!isInside(projectRoot, absolute)) {
    throw new RenderproveError(`${label} must stay inside the project root.`, {
      code: 'UNSAFE_ADVICE_PATH',
    });
  }
  let stat;
  try {
    stat = await fs.lstat(absolute);
  } catch (cause) {
    throw new RenderproveError(`${label} does not exist.`, {
      code: 'ADVICE_PATH_NOT_FOUND',
      cause,
    });
  }
  if (stat.isSymbolicLink()) {
    throw new RenderproveError(`${label} must not be a symbolic link.`, {
      code: 'UNSAFE_ADVICE_PATH',
    });
  }
  const real = await fs.realpath(absolute);
  if (!isInside(projectRoot, real)) {
    throw new RenderproveError(`${label} resolves outside the project root.`, {
      code: 'UNSAFE_ADVICE_PATH',
    });
  }
  return real;
}

async function walk(candidate, projectRoot, files, omissions, { respectDefaultExcludes }) {
  const relative = toProjectPath(projectRoot, candidate);
  const base = path.basename(candidate);
  if (relative && SENSITIVE_NAME.test(relative)) {
    omissions.push({ path: '[sensitive-path]', reason: 'sensitive-name' });
    return;
  }
  const stat = await fs.lstat(candidate);
  if (stat.isSymbolicLink()) {
    omissions.push({ path: relative || base, reason: 'symlink' });
    return;
  }
  if (stat.isDirectory()) {
    if (relative && respectDefaultExcludes && DEFAULT_EXCLUDED_DIRECTORIES.has(base)) return;
    const entries = await fs.readdir(candidate, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      await walk(path.join(candidate, entry.name), projectRoot, files, omissions, { respectDefaultExcludes });
    }
    return;
  }
  if (stat.isFile() && isTextPath(candidate)) files.add(candidate);
}

function priority(projectRoot, filePath, manifestPath, receiptPath) {
  if (filePath === manifestPath) return 0;
  if (receiptPath && filePath === receiptPath) return 1;
  const relative = toProjectPath(projectRoot, filePath);
  if (/^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|README(?:\..*)?|tsconfig(?:\..*)?\.json)$/i.test(relative)) return 2;
  if (/^(?:src|app|pages|components|lib)\//.test(relative)) return 3;
  return 4;
}

async function readCandidate(filePath, projectRoot, maxFileBytes) {
  const relative = toProjectPath(projectRoot, filePath);
  const stat = await fs.lstat(filePath);
  if (stat.isSymbolicLink()) return { omission: { path: relative, reason: 'symlink' } };
  if (stat.size > maxFileBytes) return { omission: { path: relative, reason: 'file-too-large', bytes: stat.size } };
  const buffer = await fs.readFile(filePath);
  if (buffer.includes(0)) return { omission: { path: relative, reason: 'binary' } };
  let decoded;
  try {
    decoded = UTF8.decode(buffer);
  } catch {
    return { omission: { path: relative, reason: 'invalid-utf8' } };
  }
  const normalized = decoded.replace(/\r\n?/g, '\n');
  const sanitized = redactSecrets(normalized);
  const bytes = Buffer.byteLength(sanitized.content);
  return {
    file: {
      path: relative,
      bytes,
      sha256: crypto.createHash('sha256').update(sanitized.content).digest('hex'),
      redactions: sanitized.redactions,
      content: sanitized.content,
    },
  };
}

export async function buildAdviceBundle({
  projectRoot = process.cwd(),
  manifestPath,
  receiptPath,
  includePaths = [],
  maxFiles,
  maxBytes,
  maxFileBytes,
} = {}) {
  const projectReal = await fs.realpath(path.resolve(projectRoot));
  const manifest = await loadManifest({ projectRoot: projectReal, manifestPath });
  const resolvedManifest = await existingRealPath(projectReal, manifest.sourcePath, 'Manifest path');
  const fileLimit = normalizeLimit(maxFiles, DEFAULT_MAX_FILES, 'maxFiles', { min: 1, max: 256 });
  const byteLimit = normalizeLimit(maxBytes, DEFAULT_MAX_BYTES, 'maxBytes', { min: 1_024, max: 4_000_000 });
  const perFileLimit = normalizeLimit(maxFileBytes, DEFAULT_MAX_FILE_BYTES, 'maxFileBytes', { min: 1_024, max: 1_000_000 });
  const omissions = [];
  const candidates = new Set([resolvedManifest]);

  let resolvedReceipt = null;
  const defaultReceipt = path.join(projectReal, manifest.review.outputDir, 'receipt.json');
  if (receiptPath) {
    resolvedReceipt = await existingRealPath(projectReal, receiptPath, 'Receipt path');
    candidates.add(resolvedReceipt);
  } else {
    try {
      resolvedReceipt = await existingRealPath(projectReal, defaultReceipt, 'Receipt path');
      candidates.add(resolvedReceipt);
    } catch (error) {
      if (error?.code !== 'ADVICE_PATH_NOT_FOUND') throw error;
      omissions.push({ path: toProjectPath(projectReal, defaultReceipt), reason: 'receipt-missing' });
    }
  }

  if (includePaths.length > 0) {
    for (const requested of includePaths) {
      const resolved = await existingRealPath(projectReal, requested, 'Included path');
      await walk(resolved, projectReal, candidates, omissions, { respectDefaultExcludes: false });
    }
  } else {
    await walk(projectReal, projectReal, candidates, omissions, { respectDefaultExcludes: true });
  }

  const ordered = [...candidates].sort((left, right) => {
    const difference = priority(projectReal, left, resolvedManifest, resolvedReceipt)
      - priority(projectReal, right, resolvedManifest, resolvedReceipt);
    return difference || compareText(toProjectPath(projectReal, left), toProjectPath(projectReal, right));
  });

  const files = [];
  let bytes = 0;
  let redactions = 0;
  for (const candidate of ordered) {
    if (files.length >= fileLimit) {
      omissions.push({ path: toProjectPath(projectReal, candidate), reason: 'file-limit' });
      continue;
    }
    const result = await readCandidate(candidate, projectReal, perFileLimit);
    if (result.omission) {
      omissions.push(result.omission);
      continue;
    }
    if (bytes + result.file.bytes > byteLimit) {
      omissions.push({ path: result.file.path, reason: 'byte-limit', bytes: result.file.bytes });
      continue;
    }
    files.push(result.file);
    bytes += result.file.bytes;
    redactions += result.file.redactions;
  }

  if (files.length === 0) {
    throw new RenderproveError('No eligible advisory files were found.', { code: 'EMPTY_ADVICE_BUNDLE' });
  }

  const digestInput = {
    version: 1,
    project: manifest.project,
    files: files.map(({ path: filePath, bytes: fileBytes, sha256, redactions: count, content }) => ({
      path: filePath,
      bytes: fileBytes,
      sha256,
      redactions: count,
      content,
    })),
  };
  const sha256 = crypto.createHash('sha256').update(JSON.stringify(digestInput)).digest('hex');
  return Object.freeze({
    version: 1,
    generatedAt: new Date().toISOString(),
    project: manifest.project,
    manifest: toProjectPath(projectReal, resolvedManifest),
    receipt: resolvedReceipt ? toProjectPath(projectReal, resolvedReceipt) : null,
    sha256,
    limits: { maxFiles: fileLimit, maxBytes: byteLimit, maxFileBytes: perFileLimit },
    summary: { files: files.length, bytes, redactions, omissions: omissions.length },
    files,
    omissions,
  });
}

export function summarizeAdviceBundle(bundle) {
  return {
    version: bundle.version,
    project: bundle.project,
    manifest: bundle.manifest,
    receipt: bundle.receipt,
    sha256: bundle.sha256,
    summary: bundle.summary,
    files: bundle.files.map(({ path: filePath, bytes, sha256, redactions }) => ({
      path: filePath,
      bytes,
      sha256,
      redactions,
    })),
    omissions: bundle.omissions,
  };
}
