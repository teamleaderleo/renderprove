import { RenderproveError } from '../core/errors.mjs';

export const JUST_NOTICEABLE_DELTA_E = 1;
export const OBVIOUS_DELTA_E = 2;
export const VISUAL_COMPARISON_ALGORITHM = 'cielab-d65-cie76-alpha-weighted-v1';

const HISTOGRAM_BINS = 4_000;
const BIN_WIDTH = 0.05;
const LINEAR = buildLinearTable();

function buildLinearTable() {
  const table = new Float64Array(256);
  for (let index = 0; index < table.length; index += 1) {
    const channel = index / 255;
    table[index] = channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  }
  return table;
}

function pivot(value) {
  return value > 216 / 24_389
    ? Math.cbrt(value)
    : (24_389 / 27 * value + 16) / 116;
}

function toLab(rgba, offset, output) {
  const red = LINEAR[rgba[offset]];
  const green = LINEAR[rgba[offset + 1]];
  const blue = LINEAR[rgba[offset + 2]];
  const x = (0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / 0.95047;
  const y = 0.2126729 * red + 0.7151522 * green + 0.072175 * blue;
  const z = (0.0193339 * red + 0.119192 * green + 0.9503041 * blue) / 1.08883;
  const fx = pivot(x);
  const fy = pivot(y);
  const fz = pivot(z);
  output[0] = 116 * fy - 16;
  output[1] = 500 * (fx - fy);
  output[2] = 200 * (fy - fz);
}

function percentile(histogram, total, quantile) {
  if (total === 0) return 0;
  const target = Math.ceil(total * quantile);
  let seen = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    seen += histogram[index];
    if (seen >= target) return index * BIN_WIDTH;
  }
  return HISTOGRAM_BINS * BIN_WIDTH;
}

function fractionBelow(histogram, total, threshold) {
  if (total === 0) return 1;
  const limit = Math.min(histogram.length, Math.floor(threshold / BIN_WIDTH));
  let seen = 0;
  for (let index = 0; index < limit; index += 1) seen += histogram[index];
  return seen / total;
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}

function normalizeThresholds(input = {}) {
  const thresholds = {
    maxP99DeltaE: input.maxP99DeltaE ?? JUST_NOTICEABLE_DELTA_E,
    maxObviousFraction: input.maxObviousFraction ?? 0,
    maxAlphaError: input.maxAlphaError ?? 2,
  };
  if (!Number.isFinite(thresholds.maxP99DeltaE) || thresholds.maxP99DeltaE < 0 || thresholds.maxP99DeltaE > 200) {
    throw new RenderproveError('maxP99DeltaE must be between 0 and 200.', { code: 'INVALID_VISUAL_THRESHOLD' });
  }
  if (!Number.isFinite(thresholds.maxObviousFraction) || thresholds.maxObviousFraction < 0 || thresholds.maxObviousFraction > 1) {
    throw new RenderproveError('maxObviousFraction must be between 0 and 1.', { code: 'INVALID_VISUAL_THRESHOLD' });
  }
  if (!Number.isInteger(thresholds.maxAlphaError) || thresholds.maxAlphaError < 0 || thresholds.maxAlphaError > 255) {
    throw new RenderproveError('maxAlphaError must be an integer between 0 and 255.', { code: 'INVALID_VISUAL_THRESHOLD' });
  }
  return Object.freeze(thresholds);
}

function validatePixels(reference, candidate, width, height) {
  if (!(reference instanceof Uint8Array) || !(candidate instanceof Uint8Array)) {
    throw new RenderproveError('Visual comparison requires RGBA byte arrays.', { code: 'INVALID_VISUAL_PIXELS' });
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RenderproveError('Visual comparison dimensions must be positive integers.', { code: 'INVALID_VISUAL_PIXELS' });
  }
  const expected = width * height * 4;
  if (reference.length !== expected || candidate.length !== expected) {
    throw new RenderproveError('Visual comparison images must have equal width, height, and RGBA length.', {
      code: 'VISUAL_DIMENSION_MISMATCH',
      details: { width, height, referenceBytes: reference.length, candidateBytes: candidate.length },
    });
  }
}

export function compareRgba(reference, candidate, width, height, { thresholds: thresholdInput } = {}) {
  validatePixels(reference, candidate, width, height);
  const thresholds = normalizeThresholds(thresholdInput);
  const histogram = new Uint32Array(HISTOGRAM_BINS + 1);
  const deltaEMap = new Float32Array(width * height);
  const leftLab = new Float64Array(3);
  const rightLab = new Float64Array(3);
  let visiblePixels = 0;
  let exactChangedPixels = 0;
  let weightedSum = 0;
  let weightTotal = 0;
  let maxDeltaE = 0;
  let maxAlphaError = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const alpha = reference[offset + 3];
    const alphaError = Math.abs(alpha - candidate[offset + 3]);
    if (alphaError > maxAlphaError) maxAlphaError = alphaError;
    if (
      reference[offset] !== candidate[offset]
      || reference[offset + 1] !== candidate[offset + 1]
      || reference[offset + 2] !== candidate[offset + 2]
      || alphaError !== 0
    ) exactChangedPixels += 1;
    if (alpha === 0) continue;
    visiblePixels += 1;
    toLab(reference, offset, leftLab);
    toLab(candidate, offset, rightLab);
    const dl = leftLab[0] - rightLab[0];
    const da = leftLab[1] - rightLab[1];
    const db = leftLab[2] - rightLab[2];
    const coverage = alpha / 255;
    const deltaE = Math.sqrt(dl * dl + da * da + db * db) * coverage;
    deltaEMap[pixel] = deltaE;
    weightedSum += deltaE;
    weightTotal += coverage;
    if (deltaE > maxDeltaE) maxDeltaE = deltaE;
    histogram[Math.min(HISTOGRAM_BINS, Math.floor(deltaE / BIN_WIDTH))] += 1;
  }
  const metrics = Object.freeze({
    pixels: width * height,
    visiblePixels,
    exactChangedPixels,
    exactChangedFraction: round(exactChangedPixels / (width * height)),
    meanDeltaE: round(weightTotal === 0 ? 0 : weightedSum / weightTotal),
    p95DeltaE: round(percentile(histogram, visiblePixels, 0.95)),
    p99DeltaE: round(percentile(histogram, visiblePixels, 0.99)),
    maxDeltaE: round(maxDeltaE),
    imperceptibleFraction: round(fractionBelow(histogram, visiblePixels, JUST_NOTICEABLE_DELTA_E)),
    obviousFraction: round(1 - fractionBelow(histogram, visiblePixels, OBVIOUS_DELTA_E)),
    maxAlphaError,
  });
  const failures = [];
  if (metrics.p99DeltaE > thresholds.maxP99DeltaE) failures.push('p99-delta-e');
  if (metrics.obviousFraction > thresholds.maxObviousFraction) failures.push('obvious-fraction');
  if (metrics.maxAlphaError > thresholds.maxAlphaError) failures.push('alpha-error');
  return Object.freeze({
    algorithm: VISUAL_COMPARISON_ALGORITHM,
    status: failures.length === 0 ? 'passed' : 'failed',
    thresholds,
    failures,
    metrics,
    deltaEMap,
  });
}

export function deltaEHeatmap(deltaEMap) {
  if (!(deltaEMap instanceof Float32Array) && !(deltaEMap instanceof Float64Array)) {
    throw new RenderproveError('Delta-E heatmap requires a floating-point map.', { code: 'INVALID_DELTA_E_MAP' });
  }
  const rgba = new Uint8Array(deltaEMap.length * 4);
  for (let pixel = 0; pixel < deltaEMap.length; pixel += 1) {
    const value = Math.max(0, deltaEMap[pixel]);
    const offset = pixel * 4;
    if (value < JUST_NOTICEABLE_DELTA_E) {
      rgba[offset] = Math.round(255 * value / JUST_NOTICEABLE_DELTA_E);
      rgba[offset + 1] = 0;
    } else if (value < OBVIOUS_DELTA_E) {
      rgba[offset] = 255;
      rgba[offset + 1] = Math.round(255 * (value - JUST_NOTICEABLE_DELTA_E) / (OBVIOUS_DELTA_E - JUST_NOTICEABLE_DELTA_E));
    } else {
      rgba[offset] = 255;
      rgba[offset + 1] = 255;
    }
    rgba[offset + 2] = 0;
    rgba[offset + 3] = 255;
  }
  return rgba;
}

function sourceRange(index, sourceSize, targetSize) {
  const start = index * sourceSize / targetSize;
  const end = (index + 1) * sourceSize / targetSize;
  return { start, end, first: Math.floor(start), last: Math.ceil(end) - 1 };
}

export function reduceDeltaEMax(deltaEMap, width, height, targetWidth, targetHeight) {
  if (!(deltaEMap instanceof Float32Array) && !(deltaEMap instanceof Float64Array)) {
    throw new RenderproveError('Delta-E reduction requires a floating-point map.', { code: 'INVALID_DELTA_E_MAP' });
  }
  if (deltaEMap.length !== width * height) {
    throw new RenderproveError('Delta-E map length does not match its dimensions.', { code: 'INVALID_DELTA_E_MAP' });
  }
  if (!Number.isInteger(targetWidth) || !Number.isInteger(targetHeight) || targetWidth < 1 || targetHeight < 1 || targetWidth > width || targetHeight > height) {
    throw new RenderproveError('Difference panels may only reduce positive image dimensions.', { code: 'INVALID_VISUAL_PANEL' });
  }
  const output = new Float32Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const vertical = sourceRange(y, height, targetHeight);
    for (let x = 0; x < targetWidth; x += 1) {
      const horizontal = sourceRange(x, width, targetWidth);
      let maximum = 0;
      for (let sourceY = vertical.first; sourceY <= vertical.last; sourceY += 1) {
        for (let sourceX = horizontal.first; sourceX <= horizontal.last; sourceX += 1) {
          const value = deltaEMap[sourceY * width + sourceX];
          if (value > maximum) maximum = value;
        }
      }
      output[y * targetWidth + x] = maximum;
    }
  }
  return output;
}

export function reduceRgbaArea(rgba, width, height, targetWidth, targetHeight) {
  if (!(rgba instanceof Uint8Array) || rgba.length !== width * height * 4) {
    throw new RenderproveError('RGBA reduction input does not match its dimensions.', { code: 'INVALID_VISUAL_PIXELS' });
  }
  if (!Number.isInteger(targetWidth) || !Number.isInteger(targetHeight) || targetWidth < 1 || targetHeight < 1 || targetWidth > width || targetHeight > height) {
    throw new RenderproveError('Visual panels may only reduce positive image dimensions.', { code: 'INVALID_VISUAL_PANEL' });
  }
  if (targetWidth === width && targetHeight === height) return new Uint8Array(rgba);
  const output = new Uint8Array(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const vertical = sourceRange(y, height, targetHeight);
    for (let x = 0; x < targetWidth; x += 1) {
      const horizontal = sourceRange(x, width, targetWidth);
      let weightTotal = 0;
      let alphaSum = 0;
      let redSum = 0;
      let greenSum = 0;
      let blueSum = 0;
      for (let sourceY = vertical.first; sourceY <= vertical.last; sourceY += 1) {
        const verticalWeight = Math.min(vertical.end, sourceY + 1) - Math.max(vertical.start, sourceY);
        for (let sourceX = horizontal.first; sourceX <= horizontal.last; sourceX += 1) {
          const horizontalWeight = Math.min(horizontal.end, sourceX + 1) - Math.max(horizontal.start, sourceX);
          const weight = verticalWeight * horizontalWeight;
          const offset = (sourceY * width + sourceX) * 4;
          const alpha = rgba[offset + 3] / 255;
          weightTotal += weight;
          alphaSum += weight * alpha;
          redSum += weight * alpha * rgba[offset];
          greenSum += weight * alpha * rgba[offset + 1];
          blueSum += weight * alpha * rgba[offset + 2];
        }
      }
      const target = (y * targetWidth + x) * 4;
      output[target + 3] = Math.round(255 * alphaSum / weightTotal);
      if (alphaSum > 0) {
        output[target] = Math.round(redSum / alphaSum);
        output[target + 1] = Math.round(greenSum / alphaSum);
        output[target + 2] = Math.round(blueSum / alphaSum);
      }
    }
  }
  return output;
}

function blit(target, targetWidth, source, sourceWidth, sourceHeight, offsetX, offsetY) {
  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < sourceWidth; x += 1) {
      const sourceOffset = (y * sourceWidth + x) * 4;
      const targetOffset = ((y + offsetY) * targetWidth + x + offsetX) * 4;
      target[targetOffset] = source[sourceOffset];
      target[targetOffset + 1] = source[sourceOffset + 1];
      target[targetOffset + 2] = source[sourceOffset + 2];
      target[targetOffset + 3] = source[sourceOffset + 3];
    }
  }
}

export function buildComparisonPanels(reference, candidate, deltaEMap, width, height, { maxPanelEdge = 1_024, gap = 8 } = {}) {
  validatePixels(reference, candidate, width, height);
  if (!Number.isInteger(maxPanelEdge) || maxPanelEdge < 32 || maxPanelEdge > 4_096) {
    throw new RenderproveError('maxPanelEdge must be between 32 and 4096.', { code: 'INVALID_VISUAL_PANEL' });
  }
  if (!Number.isInteger(gap) || gap < 0 || gap > 128) {
    throw new RenderproveError('Panel gap must be between 0 and 128.', { code: 'INVALID_VISUAL_PANEL' });
  }
  const scale = Math.min(1, maxPanelEdge / Math.max(width, height));
  const panelWidth = Math.max(1, Math.round(width * scale));
  const panelHeight = Math.max(1, Math.round(height * scale));
  const referencePanel = reduceRgbaArea(reference, width, height, panelWidth, panelHeight);
  const candidatePanel = reduceRgbaArea(candidate, width, height, panelWidth, panelHeight);
  const differencePanel = deltaEHeatmap(reduceDeltaEMax(deltaEMap, width, height, panelWidth, panelHeight));
  const outputWidth = panelWidth * 3 + gap * 2;
  const output = new Uint8Array(outputWidth * panelHeight * 4);
  for (let offset = 0; offset < output.length; offset += 4) {
    output[offset] = 20;
    output[offset + 1] = 22;
    output[offset + 2] = 26;
    output[offset + 3] = 255;
  }
  blit(output, outputWidth, referencePanel, panelWidth, panelHeight, 0, 0);
  blit(output, outputWidth, candidatePanel, panelWidth, panelHeight, panelWidth + gap, 0);
  blit(output, outputWidth, differencePanel, panelWidth, panelHeight, (panelWidth + gap) * 2, 0);
  return Object.freeze({
    panelWidth,
    panelHeight,
    gap,
    reference: referencePanel,
    candidate: candidatePanel,
    difference: differencePanel,
    triptych: Object.freeze({ width: outputWidth, height: panelHeight, data: output }),
  });
}
