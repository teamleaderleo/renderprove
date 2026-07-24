import fs from 'node:fs/promises';
import path from 'node:path';
import { RenderproveError } from '../core/errors.mjs';
import { findManifest } from '../core/manifest.mjs';
import { isOutsideRoot } from '../core/paths.mjs';

async function requireDirectory(candidate, label) {
  let realPath;
  let stats;
  try {
    realPath = await fs.realpath(candidate);
    stats = await fs.stat(realPath);
  } catch (cause) {
    throw new RenderproveError(`${label} does not exist or cannot be read.`, {
      code: 'MCP_PATH_UNAVAILABLE',
      cause,
    });
  }
  if (!stats.isDirectory()) {
    throw new RenderproveError(`${label} must be a directory.`, { code: 'MCP_PATH_NOT_DIRECTORY' });
  }
  return realPath;
}

export async function resolveOperatorRoot(root) {
  if (typeof root !== 'string' || root.trim().length === 0) {
    throw new RenderproveError('MCP root must be a non-empty path.', { code: 'INVALID_MCP_ROOT' });
  }
  return requireDirectory(path.resolve(root), 'MCP root');
}

export async function resolveMcpProject(operatorRoot, project = '.') {
  if (typeof project !== 'string' || project.trim().length === 0 || project.includes('\0')) {
    throw new RenderproveError('Project must be a non-empty path.', { code: 'INVALID_MCP_PROJECT' });
  }
  const lexicalProject = path.resolve(operatorRoot, project);
  if (isOutsideRoot(operatorRoot, lexicalProject)) {
    throw new RenderproveError('Project must stay inside the configured MCP root.', {
      code: 'MCP_PROJECT_OUTSIDE_ROOT',
    });
  }
  const projectRoot = await requireDirectory(lexicalProject, 'Project');
  if (isOutsideRoot(operatorRoot, projectRoot)) {
    throw new RenderproveError('Project symlink resolves outside the configured MCP root.', {
      code: 'MCP_PROJECT_OUTSIDE_ROOT',
    });
  }
  return {
    projectRoot,
    projectPath: path.relative(operatorRoot, projectRoot) || '.',
  };
}

export async function resolveMcpManifest(projectRoot, manifestPath) {
  const lexicalManifest = await findManifest(projectRoot, manifestPath);
  let realManifest;
  try {
    realManifest = await fs.realpath(lexicalManifest);
  } catch (cause) {
    throw new RenderproveError('Manifest does not exist or cannot be read.', {
      code: 'MCP_MANIFEST_UNAVAILABLE',
      cause,
    });
  }
  if (isOutsideRoot(projectRoot, realManifest)) {
    throw new RenderproveError('Manifest symlink resolves outside the selected project.', {
      code: 'MCP_MANIFEST_OUTSIDE_PROJECT',
    });
  }
  return path.relative(projectRoot, realManifest) || path.basename(realManifest);
}
