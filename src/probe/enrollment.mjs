import fs from 'node:fs/promises';
import path from 'node:path';

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function requireRelativeOutput(output) {
  if (typeof output !== 'string' || output.length === 0 || path.isAbsolute(output)) {
    throw new TypeError('evidence output must be a non-empty project-relative path');
  }
  const normalized = path.normalize(output);
  if (normalized === '.' || normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new TypeError('evidence output must stay inside the project');
  }
  return normalized;
}

async function realPathForCreation(candidate) {
  const missing = [];
  let cursor = candidate;
  while (true) {
    try {
      const realAncestor = await fs.realpath(cursor);
      return path.resolve(realAncestor, ...missing);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missing.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

export async function resolveProbePaths({
  toolRoot,
  enrolledRoot = toolRoot,
  project,
  output,
}) {
  if (typeof toolRoot !== 'string' || toolRoot.length === 0) throw new TypeError('toolRoot is required');
  if (typeof enrolledRoot !== 'string' || enrolledRoot.length === 0) throw new TypeError('enrolledRoot is required');
  if (typeof project !== 'string' || project.length === 0) throw new TypeError('project is required');

  const toolRootReal = await fs.realpath(path.resolve(toolRoot));
  const enrolledInput = path.isAbsolute(enrolledRoot)
    ? enrolledRoot
    : path.resolve(toolRootReal, enrolledRoot);
  const enrolledRootReal = await fs.realpath(enrolledInput);
  const projectInput = path.isAbsolute(project)
    ? project
    : path.resolve(enrolledRootReal, project);
  const projectRoot = await fs.realpath(projectInput);

  if (!isInside(enrolledRootReal, projectRoot)) {
    throw new Error(`project must stay inside the enrolled root: ${projectRoot}`);
  }

  const normalizedOutput = requireRelativeOutput(output);
  const evidenceRoot = await realPathForCreation(path.resolve(projectRoot, normalizedOutput));
  if (!isInside(projectRoot, evidenceRoot) || evidenceRoot === projectRoot) {
    throw new Error(`evidence output must stay inside the project: ${evidenceRoot}`);
  }

  return Object.freeze({
    toolRoot: toolRootReal,
    enrolledRoot: enrolledRootReal,
    projectRoot,
    evidenceRoot,
    containerOutput: path.relative(projectRoot, evidenceRoot),
  });
}
