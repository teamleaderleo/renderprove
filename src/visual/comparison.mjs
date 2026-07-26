import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RenderproveError } from '../core/errors.mjs';
import { buildComparisonPanels, compareRgba, deltaEHeatmap } from './delta-e.mjs';
import { decodePng, encodePng } from './png.mjs';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function displayPath(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    return relative.split(path.sep).join('/') || path.basename(absolutePath);
  }
  return path.basename(absolutePath);
}

async function writeAtomic(targetPath, value) {
  const temporary = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  await fs.writeFile(temporary, value, { mode: 0o600 });
  await fs.rename(temporary, targetPath);
}

function digestPanels(panels) {
  const header = Buffer.from(JSON.stringify({
    version: 1,
    panelWidth: panels.panelWidth,
    panelHeight: panels.panelHeight,
    gap: panels.gap,
    order: ['reference', 'candidate', 'difference'],
  }));
  return sha256(Buffer.concat([
    header,
    Buffer.from(panels.reference),
    Buffer.from(panels.candidate),
    Buffer.from(panels.difference),
  ]));
}

export async function comparePngFiles({
  referencePath,
  candidatePath,
  outputDir = '.renderprove-compare',
  cwd = process.cwd(),
  thresholds,
  maxPanelEdge,
} = {}) {
  if (typeof referencePath !== 'string' || referencePath.trim().length === 0) {
    throw new RenderproveError('A reference PNG path is required.', { code: 'VISUAL_REFERENCE_REQUIRED' });
  }
  if (typeof candidatePath !== 'string' || candidatePath.trim().length === 0) {
    throw new RenderproveError('A candidate PNG path is required.', { code: 'VISUAL_CANDIDATE_REQUIRED' });
  }
  const root = path.resolve(cwd);
  const referenceAbsolute = path.resolve(root, referencePath);
  const candidateAbsolute = path.resolve(root, candidatePath);
  const outputAbsolute = path.resolve(root, outputDir);
  let referenceBuffer;
  let candidateBuffer;
  try {
    [referenceBuffer, candidateBuffer] = await Promise.all([
      fs.readFile(referenceAbsolute),
      fs.readFile(candidateAbsolute),
    ]);
  } catch (cause) {
    throw new RenderproveError('Unable to read one or both comparison PNG files.', {
      code: 'VISUAL_INPUT_NOT_FOUND',
      cause,
    });
  }
  const reference = decodePng(referenceBuffer);
  const candidate = decodePng(candidateBuffer);
  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    throw new RenderproveError('Reference and candidate PNG dimensions differ.', {
      code: 'VISUAL_DIMENSION_MISMATCH',
      details: {
        reference: { width: reference.width, height: reference.height },
        candidate: { width: candidate.width, height: candidate.height },
      },
    });
  }
  const comparison = compareRgba(
    reference.data,
    candidate.data,
    reference.width,
    reference.height,
    { thresholds },
  );
  const differenceBuffer = encodePng({
    width: reference.width,
    height: reference.height,
    data: deltaEHeatmap(comparison.deltaEMap),
  });
  const panels = buildComparisonPanels(
    reference.data,
    candidate.data,
    comparison.deltaEMap,
    reference.width,
    reference.height,
    { maxPanelEdge },
  );
  const triptychBuffer = encodePng(panels.triptych);
  await fs.mkdir(outputAbsolute, { recursive: true });
  const differencePath = path.join(outputAbsolute, 'difference.png');
  const triptychPath = path.join(outputAbsolute, 'comparison.png');
  const resultPath = path.join(outputAbsolute, 'comparison.json');
  await Promise.all([
    writeAtomic(differencePath, differenceBuffer),
    writeAtomic(triptychPath, triptychBuffer),
  ]);
  const result = Object.freeze({
    version: 1,
    deterministic: true,
    algorithm: comparison.algorithm,
    status: comparison.status,
    failures: comparison.failures,
    thresholds: comparison.thresholds,
    images: {
      reference: {
        path: displayPath(root, referenceAbsolute),
        width: reference.width,
        height: reference.height,
        sha256: sha256(referenceBuffer),
      },
      candidate: {
        path: displayPath(root, candidateAbsolute),
        width: candidate.width,
        height: candidate.height,
        sha256: sha256(candidateBuffer),
      },
    },
    metrics: comparison.metrics,
    artifacts: {
      difference: 'difference.png',
      differenceSha256: sha256(differenceBuffer),
      comparison: 'comparison.png',
      comparisonSha256: sha256(triptychBuffer),
      panelsSha256: digestPanels(panels),
      panelWidth: panels.panelWidth,
      panelHeight: panels.panelHeight,
      panelOrder: ['reference', 'candidate', 'difference'],
    },
  });
  await writeAtomic(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  return Object.freeze({
    result,
    resultPath,
    differencePath,
    comparisonPath: triptychPath,
  });
}

export function summarizeVisualComparison(result) {
  return [
    `Visual comparison: ${result.status}`,
    `Algorithm: ${result.algorithm}`,
    `p99 ΔE: ${result.metrics.p99DeltaE} (limit ${result.thresholds.maxP99DeltaE})`,
    `Obvious pixels: ${(result.metrics.obviousFraction * 100).toFixed(2)}% (limit ${(result.thresholds.maxObviousFraction * 100).toFixed(2)}%)`,
    `Exact changed pixels: ${result.metrics.exactChangedPixels}/${result.metrics.pixels}`,
    result.failures.length > 0 ? `Failures: ${result.failures.join(', ')}` : 'Failures: none',
  ].join('\n');
}
