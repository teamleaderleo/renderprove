import fs from 'node:fs/promises';
import path from 'node:path';
import { RenderproveError } from './errors.mjs';

export const DEFAULT_MANIFEST_NAMES = ['renderprove.json', '.renderprove.json'];

const VIEWPORT_PRESETS = Object.freeze({
  desktop: { name: 'desktop', width: 1440, height: 1000, deviceScaleFactor: 1 },
  mobile: { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 1 },
  tablet: { name: 'tablet', width: 820, height: 1180, deviceScaleFactor: 1 },
});

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RenderproveError(`${label} must be an object.`, { code: 'INVALID_MANIFEST' });
  }
  return value;
}

function assertKnownKeys(object, allowed, label) {
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new RenderproveError(`${label} contains unknown fields: ${unknown.join(', ')}.`, {
      code: 'INVALID_MANIFEST',
      details: { unknown },
    });
  }
}

function normalizePositiveInteger(value, fallback, label, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate < min || candidate > max) {
    throw new RenderproveError(`${label} must be an integer between ${min} and ${max}.`, {
      code: 'INVALID_MANIFEST',
    });
  }
  return candidate;
}

function normalizeUrl(value, label) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
    if (url.username || url.password) throw new Error('embedded credentials are unsupported');
    return url.toString().replace(/\/$/, '');
  } catch (cause) {
    throw new RenderproveError(`${label} must be an HTTP or HTTPS URL.`, {
      code: 'INVALID_MANIFEST',
      cause,
    });
  }
}

function normalizeRuntime(runtime, projectRoot) {
  if (runtime == null) return null;
  assertObject(runtime, 'runtime');
  assertKnownKeys(runtime, ['command', 'cwd', 'env', 'port', 'readyPath', 'timeoutMs', 'shutdownMs'], 'runtime');
  if (!Array.isArray(runtime.command) || runtime.command.length === 0 || runtime.command.some((part) => typeof part !== 'string' || part.length === 0)) {
    throw new RenderproveError('runtime.command must be a non-empty string array.', { code: 'INVALID_MANIFEST' });
  }
  const env = runtime.env ?? {};
  assertObject(env, 'runtime.env');
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string') {
      throw new RenderproveError('runtime.env must map valid environment names to strings.', { code: 'INVALID_MANIFEST' });
    }
  }
  if (typeof runtime.cwd !== 'undefined' && (typeof runtime.cwd !== 'string' || runtime.cwd.trim().length === 0)) {
    throw new RenderproveError('runtime.cwd must be a non-empty string.', { code: 'INVALID_MANIFEST' });
  }
  const runtimeCwd = path.resolve(projectRoot, runtime.cwd ?? '.');
  const cwdRelative = path.relative(path.resolve(projectRoot), runtimeCwd);
  if (cwdRelative.startsWith('..') || path.isAbsolute(cwdRelative)) {
    throw new RenderproveError('runtime.cwd must stay inside the project root.', { code: 'INVALID_MANIFEST' });
  }
  const readyPath = runtime.readyPath ?? '/';
  if (typeof readyPath !== 'string' || !readyPath.startsWith('/')) {
    throw new RenderproveError('runtime.readyPath must start with /.', { code: 'INVALID_MANIFEST' });
  }
  return {
    command: [...runtime.command],
    cwd: runtime.cwd ?? '.',
    env: { ...env },
    port: normalizePositiveInteger(runtime.port, undefined, 'runtime.port', { min: 1024, max: 65535 }),
    readyPath,
    timeoutMs: normalizePositiveInteger(runtime.timeoutMs, 30_000, 'runtime.timeoutMs', { min: 1_000, max: 300_000 }),
    shutdownMs: normalizePositiveInteger(runtime.shutdownMs, 5_000, 'runtime.shutdownMs', { min: 100, max: 60_000 }),
  };
}

function normalizeViewport(viewport, index) {
  if (typeof viewport === 'string') {
    const preset = VIEWPORT_PRESETS[viewport];
    if (!preset) {
      throw new RenderproveError(`review.viewports[${index}] uses unknown preset ${viewport}.`, { code: 'INVALID_MANIFEST' });
    }
    return { ...preset };
  }
  assertObject(viewport, `review.viewports[${index}]`);
  assertKnownKeys(viewport, ['name', 'width', 'height', 'deviceScaleFactor'], `review.viewports[${index}]`);
  const name = viewport.name;
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new RenderproveError(`review.viewports[${index}].name must be a non-empty string.`, { code: 'INVALID_MANIFEST' });
  }
  return {
    name: name.trim(),
    width: normalizePositiveInteger(viewport.width, undefined, `review.viewports[${index}].width`, { min: 240, max: 7680 }),
    height: normalizePositiveInteger(viewport.height, undefined, `review.viewports[${index}].height`, { min: 240, max: 7680 }),
    deviceScaleFactor: normalizePositiveInteger(viewport.deviceScaleFactor, 1, `review.viewports[${index}].deviceScaleFactor`, { min: 1, max: 3 }),
  };
}

function normalizeRoute(route, index) {
  const value = typeof route === 'string' ? { path: route } : assertObject(route, `review.routes[${index}]`);
  assertKnownKeys(value, ['path', 'name', 'waitForMs', 'fullPage'], `review.routes[${index}]`);
  if (typeof value.path !== 'string' || !value.path.startsWith('/')) {
    throw new RenderproveError(`review.routes[${index}].path must start with /.`, { code: 'INVALID_MANIFEST' });
  }
  if (typeof value.fullPage !== 'undefined' && typeof value.fullPage !== 'boolean') {
    throw new RenderproveError(`review.routes[${index}].fullPage must be a boolean.`, { code: 'INVALID_MANIFEST' });
  }
  return {
    path: value.path,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : value.path,
    waitForMs: normalizePositiveInteger(value.waitForMs, 250, `review.routes[${index}].waitForMs`, { min: 0, max: 30_000 }),
    fullPage: value.fullPage ?? true,
  };
}

function normalizeReview(review) {
  assertObject(review, 'review');
  assertKnownKeys(review, ['routes', 'viewports', 'failOn', 'outputDir', 'navigationTimeoutMs'], 'review');
  if (!Array.isArray(review.routes) || review.routes.length === 0) {
    throw new RenderproveError('review.routes must contain at least one route.', { code: 'INVALID_MANIFEST' });
  }
  const viewports = review.viewports ?? ['desktop', 'mobile'];
  if (!Array.isArray(viewports) || viewports.length === 0) {
    throw new RenderproveError('review.viewports must contain at least one viewport.', { code: 'INVALID_MANIFEST' });
  }
  const failOn = review.failOn ?? {};
  assertObject(failOn, 'review.failOn');
  assertKnownKeys(failOn, ['consoleError', 'pageError', 'requestFailure', 'httpError'], 'review.failOn');
  for (const [key, value] of Object.entries(failOn)) {
    if (typeof value !== 'boolean') {
      throw new RenderproveError(`review.failOn.${key} must be a boolean.`, { code: 'INVALID_MANIFEST' });
    }
  }
  if (typeof review.outputDir !== 'undefined' && (typeof review.outputDir !== 'string' || review.outputDir.trim().length === 0)) {
    throw new RenderproveError('review.outputDir must be a non-empty string.', { code: 'INVALID_MANIFEST' });
  }
  const routes = review.routes.map(normalizeRoute);
  const normalizedViewports = viewports.map(normalizeViewport);
  const duplicateRoute = routes.find((route, index) => routes.findIndex((candidate) => candidate.path === route.path) !== index);
  if (duplicateRoute) {
    throw new RenderproveError(`review.routes contains duplicate path ${duplicateRoute.path}.`, { code: 'INVALID_MANIFEST' });
  }
  const duplicateViewport = normalizedViewports.find((viewport, index) => normalizedViewports.findIndex((candidate) => candidate.name === viewport.name) !== index);
  if (duplicateViewport) {
    throw new RenderproveError(`review.viewports contains duplicate name ${duplicateViewport.name}.`, { code: 'INVALID_MANIFEST' });
  }
  return {
    routes,
    viewports: normalizedViewports,
    failOn: {
      consoleError: failOn.consoleError ?? true,
      pageError: failOn.pageError ?? true,
      requestFailure: failOn.requestFailure ?? true,
      httpError: failOn.httpError ?? true,
    },
    outputDir: review.outputDir ?? '.renderprove',
    navigationTimeoutMs: normalizePositiveInteger(review.navigationTimeoutMs, 30_000, 'review.navigationTimeoutMs', { min: 1_000, max: 300_000 }),
  };
}

export function normalizeManifest(input, { projectRoot = process.cwd(), sourcePath = null } = {}) {
  assertObject(input, 'manifest');
  assertKnownKeys(input, ['$schema', 'version', 'project', 'runtime', 'target', 'review'], 'manifest');
  if (input.version !== 1) {
    throw new RenderproveError('manifest.version must be 1.', { code: 'UNSUPPORTED_MANIFEST_VERSION' });
  }
  if (typeof input.project !== 'string' || input.project.trim().length === 0) {
    throw new RenderproveError('manifest.project must be a non-empty string.', { code: 'INVALID_MANIFEST' });
  }
  const resolvedProjectRoot = path.resolve(projectRoot);
  const runtime = normalizeRuntime(input.runtime, resolvedProjectRoot);
  const target = input.target == null ? null : assertObject(input.target, 'target');
  if (target) assertKnownKeys(target, ['baseUrl'], 'target');
  if ((runtime == null) === (target == null)) {
    throw new RenderproveError('Exactly one of runtime or target must be configured.', { code: 'INVALID_MANIFEST' });
  }
  return Object.freeze({
    version: 1,
    project: input.project.trim(),
    projectRoot: resolvedProjectRoot,
    sourcePath,
    runtime,
    target: target ? { baseUrl: normalizeUrl(target.baseUrl, 'target.baseUrl') } : null,
    review: normalizeReview(input.review),
  });
}

export async function findManifest(projectRoot, explicitPath) {
  if (explicitPath) {
    const sourcePath = path.resolve(projectRoot, explicitPath);
    const relative = path.relative(path.resolve(projectRoot), sourcePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new RenderproveError('Manifest path must stay inside the project root.', { code: 'UNSAFE_MANIFEST_PATH' });
    }
    return sourcePath;
  }
  for (const name of DEFAULT_MANIFEST_NAMES) {
    const candidate = path.resolve(projectRoot, name);
    try {
      await fs.access(candidate);
      return candidate;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  throw new RenderproveError(`No Renderprove manifest found. Expected ${DEFAULT_MANIFEST_NAMES.join(' or ')}.`, {
    code: 'MANIFEST_NOT_FOUND',
  });
}

export async function loadManifest({ projectRoot = process.cwd(), manifestPath } = {}) {
  const sourcePath = await findManifest(projectRoot, manifestPath);
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  } catch (cause) {
    throw new RenderproveError(`Unable to parse ${sourcePath} as JSON.`, {
      code: 'INVALID_MANIFEST_JSON',
      cause,
    });
  }
  return normalizeManifest(parsed, { projectRoot, sourcePath });
}
