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

async function existingRealAncestor(candidate) {
  let cursor = path.resolve(candidate);
  while (true) {
    try {
      return await fs.realpath(cursor);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      cursor = parent;
    }
  }
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
  let stats;
  try {
    realManifest = await fs.realpath(lexicalManifest);
    stats = await fs.stat(realManifest);
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
  if (!stats.isFile()) {
    throw new RenderproveError('Manifest must be a regular file.', {
      code: 'MCP_MANIFEST_NOT_FILE',
    });
  }
  return path.relative(projectRoot, realManifest) || path.basename(realManifest);
}

export async function assertMcpReviewPaths(manifest) {
  if (manifest.runtime) {
    const runtimeCwd = await requireDirectory(
      path.resolve(manifest.projectRoot, manifest.runtime.cwd),
      'Runtime working directory',
    );
    if (isOutsideRoot(manifest.projectRoot, runtimeCwd)) {
      throw new RenderproveError('Runtime working directory resolves outside the selected project.', {
        code: 'MCP_RUNTIME_OUTSIDE_PROJECT',
      });
    }
  }

  const outputPath = path.resolve(manifest.projectRoot, manifest.review.outputDir);
  if (isOutsideRoot(manifest.projectRoot, outputPath)) {
    throw new RenderproveError('Evidence output must stay inside the selected project.', {
      code: 'MCP_OUTPUT_OUTSIDE_PROJECT',
    });
  }
  let realAncestor;
  try {
    realAncestor = await existingRealAncestor(outputPath);
  } catch (cause) {
    throw new RenderproveError('Evidence output cannot be resolved safely.', {
      code: 'MCP_OUTPUT_UNAVAILABLE',
      cause,
    });
  }
  if (isOutsideRoot(manifest.projectRoot, realAncestor)) {
    throw new RenderproveError('Evidence output resolves outside the selected project.', {
      code: 'MCP_OUTPUT_OUTSIDE_PROJECT',
    });
  }
}
