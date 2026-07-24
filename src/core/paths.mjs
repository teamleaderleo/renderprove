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

export function resolveInside(root, ...segments) {
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, ...segments);
  const relative = path.relative(absoluteRoot, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new RenderproveError('Artifact path escapes the output directory.', {
      code: 'UNSAFE_ARTIFACT_PATH',
      details: { root: absoluteRoot, candidate },
    });
  }
  return candidate;
}
