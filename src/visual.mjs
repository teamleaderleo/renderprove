export {
  JUST_NOTICEABLE_DELTA_E,
  OBVIOUS_DELTA_E,
  VISUAL_COMPARISON_ALGORITHM,
  buildComparisonPanels,
  compareRgba,
  deltaEHeatmap,
  reduceDeltaEMax,
  reduceRgbaArea,
} from './visual/delta-e.mjs';
export { comparePngFiles, summarizeVisualComparison } from './visual/comparison.mjs';
export { decodePng, encodePng } from './visual/png.mjs';
