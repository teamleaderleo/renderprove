# Deterministic visual comparison

Renderprove can compare two equally sized PNG screenshots without launching a browser or calling a model:

```bash
npx renderprove compare baseline.png candidate.png
```

The command writes:

```text
.renderprove-compare/comparison.json
.renderprove-compare/difference.png
.renderprove-compare/comparison.png
```

`comparison.json` follows `schema/visual-comparison-v1.schema.json`. This artifact is separate from receipt v1; adding baseline identity and comparison references to browser receipts belongs in a later receipt version.

## Default gate

Version 1 uses alpha-weighted CIELAB Delta-E CIE76 under D65:

```text
p99 Delta-E <= 1.0
obvious-pixel fraction <= 0
maximum alpha error <= 2
```

A Delta-E below 1 is treated as below the just-noticeable threshold. Delta-E 2 or above is classified as obvious for the tail-fraction report.

Override the gate explicitly:

```bash
npx renderprove compare baseline.png candidate.png \
  --max-p99-delta-e 1.5 \
  --max-obvious-fraction 0.001 \
  --max-alpha-error 4 \
  --output .renderprove/visual/home-desktop
```

Exit codes follow the existing Renderprove convention:

```text
0  comparison passed the declared thresholds
1  comparison completed and failed one or more thresholds
2  input, decoding, configuration, or execution failure
```

## Recorded metrics

The result records:

- exact changed pixel count and fraction;
- visible reference pixels;
- alpha-weighted mean Delta-E;
- p95, p99, and maximum Delta-E;
- fraction below Delta-E 1;
- fraction at or above Delta-E 2;
- maximum absolute alpha error;
- reference and candidate dimensions and SHA-256 digests;
- the exact algorithm identifier and declared thresholds.

Tail measurements lead because a small bad region can disappear inside a whole-page average. Exact pixel counts remain beside the perceptual measurements; perceptual tolerance does not erase byte-level evidence.

## Evidence images

`difference.png` is a full-resolution heatmap generated from the same per-pixel Delta-E values used by the gate:

```text
black   below the just-noticeable range
red     Delta-E 1
Yellow  Delta-E 2 or above
```

`comparison.png` places three panels in a fixed order:

```text
reference | candidate | difference
```

The panel builder follows two rules taken from the Starsector Preflight verification work:

1. Source and candidate panels are reduced by alpha-aware area averaging and are never enlarged.
2. Difference panels reduce by maximum, not average, so a tiny severe defect survives thumbnailing.

The composed PNG has its own SHA-256 digest. The result also records `panelsSha256`, calculated over the canonical panel dimensions, order, and RGBA data. Presentation changes can therefore be separated from changes to the evidence itself.

## PNG boundary

The built-in codec accepts bounded, non-interlaced, 8-bit PNG files in grayscale, grayscale-alpha, RGB, or RGBA form. It verifies the PNG signature, chunk CRC values, dimensions, row filters, and decompressed length. The default safety ceiling is 50 million pixels per image.

Reference and candidate dimensions must match exactly. Alignment, masking, crop selection, baseline approval, and baseline replacement are deliberately outside this first slice; silently aligning two different layouts could hide the defect being measured.

## What the metric can and cannot decide

CIE76 answers a limited question: how different are corresponding rendered colours, approximately in human-perception units? It does not decide whether the screenshot represents the correct application state.

Examples outside the metric's authority include:

- correct colours attached to incorrect text;
- a control rendered in the wrong enabled or selected state;
- a modal shown for the wrong user or route;
- content replaced by visually similar blank space;
- a baseline captured from an unintended state;
- geometry changes that preserve local colours.

Keep DOM facts, interaction outcomes, route identity, layout assertions, and renderer identity as separate deterministic evidence. A future vision advisory should receive reference, candidate, difference evidence and a short explicit checklist only for semantic questions that cannot be stated as predicates.

## Algorithm evolution

The version 1 algorithm identifier is:

```text
cielab-d65-cie76-alpha-weighted-v1
```

CIE76 is compact, inspectable, and sufficient for the first bounded comparison artifact. It can underweight edge-localised rendering defects. FLIP is the planned higher-accuracy evaluator for rendered images because it models edge sensitivity and viewing conditions.

A future FLIP implementation must use a new algorithm identifier and explicit thresholds. Renderprove will not reinterpret existing CIE76 results or silently change the meaning of version 1 gates.

## Library API

```js
import {
  comparePngFiles,
  compareRgba,
  decodePng,
  encodePng
} from 'renderprove/visual';
```

`compareRgba` is the pure measurement layer. `comparePngFiles` owns file decoding, artifact generation, hashes, and atomic writes.
