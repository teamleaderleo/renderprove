import path from 'node:path';
import { RenderproveError } from './errors.mjs';

export function safeSegment(value, fallback = 'artifact') {
  const normalized = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

export function isOutsideRoot(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

export function resolveInside(root, ...segments) {
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, ...segments);
  if (isOutsideRoot(absoluteRoot, candidate)) {
    throw new RenderproveError('Artifact path escapes the output directory.', {
      code: 'UNSAFE_ARTIFACT_PATH',
      details: { root: absoluteRoot, candidate },
    });
  }
  return candidate;
}
