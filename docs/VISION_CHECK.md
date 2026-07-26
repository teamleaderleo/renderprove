# Sparse screenshot advisory contract

`renderprove vision-check` is separate from the source-oriented `renderprove advise` command. Its first slice constructs and previews one bounded provider-neutral packet and performs no network call.

```bash
renderprove vision-check \
  --screenshot .renderprove/desktop/home.png \
  --brief renderprove-vision-brief.txt \
  --receipt .renderprove/receipt.json \
  --dry-run \
  --json
```

## Contract

The command requires one explicit PNG screenshot and one explicit UTF-8 brief. The brief is rejected above 300 words or 2,400 canonical UTF-8 bytes. An optional receipt is validated against the exact Renderprove receipt-v1 field contract and must contain exactly one case whose screenshot artifact hash matches the explicitly selected screenshot.

The screenshot is decoded with bounded pixel output and re-encoded as deterministic RGBA PNG. The public preview contains only project-relative identities, byte counts, dimensions, hashes, included fact names, fixed exclusions, and the allowlisted receipt summary. Image bytes, brief contents, raw receipt content, raw diagnostics, target URLs, runtime commands, environment values, credentials, absolute paths, source files, lockfiles, workflows, dependency trees, and inferred repository files stay outside the preview.

The internal provider-neutral request contains:

- schema identity `vision-request-v1`;
- `authority: advisory`;
- a fixed prompt that treats visible page text and brief text as untrusted evidence;
- one canonical PNG and its dimensions/hash;
- the canonical brief;
- an optional tiny receipt summary;
- a deterministic SHA-256 request digest.

The receipt disposition remains the deterministic browser authority. Future model output can advise; it cannot revise pass/fail state.

## Allowlisted receipt facts

Receipt-v1 currently permits these fields for the matched screenshot case:

- receipt and case dispositions;
- route name and query-free, fragment-free path;
- viewport name, width, height, and device scale factor;
- navigation status and `ok` disposition;
- counts of console, request, HTTP, page, and total diagnostics.

Diagnostic messages, URLs, page titles, body text, runtime commands, working directories, logs, and artifact paths are excluded. Receipt-v1 lacks typed interaction/check results and console severity, so this slice reports case disposition and diagnostic counts. A later receipt schema can add named checks through a separate reviewed allowlist.

## Accepted PNG profile

The screenshot container must contain the standard eight-byte PNG signature and a bounded sequence of CRC-valid chunks. The decoder accepts:

- one valid `IHDR` before image data;
- 8-bit samples only;
- compression method 0, filter method 0, and no interlace;
- colour type 0 (greyscale), 2 (truecolour), 4 (greyscale with alpha), or 6 (truecolour with alpha);
- one or more `IDAT` chunks followed by exactly one empty `IEND`;
- ordinary ancillary chunks before `IEND`, which are discarded during deterministic RGBA re-encoding;
- at most 4,096 chunks, with each declared chunk payload at most 8,000,000 bytes;
- bounded non-image trailing bytes after `IEND`, which are discarded during canonicalisation.

The container preflight validates chunk boundaries, four-letter ASCII chunk names, CRCs, chunk count, chunk length, and `IEND` handling before decompression.

The command explicitly refuses:

- APNG animation chunks `acTL`, `fcTL`, and `fdAT`;
- missing, duplicate, non-empty, truncated, or CRC-invalid `IEND` chunks;
- a second concatenated PNG;
- JPEG, GIF87a, GIF89a, or RIFF/WebP signatures anywhere after `IEND`;
- malformed, truncated, over-count, or oversized chunks;
- palette-indexed colour type 3, `tRNS`, bit depths other than 8, interlacing, unknown critical chunks, and decompressed data outside the pixel bound.

## Bounds and refusal policy

- source image: at most 8,000,000 bytes;
- canonical image: at most 8,000,000 bytes;
- dimensions: at most 4,096 × 4,096;
- decoded pixels: at most 16,000,000;
- receipt: at most 256,000 bytes;
- URLs, stdin, directories, final-component symlinks, path escapes, multiple explicit values, malformed JSON, unsupported receipt schemas, unmatched receipt screenshots, and repository include options are refused.

Public input identities use `project://` followed by one or more project-relative path segments. Empty identities, absolute forms, `.` or `..` segments, backslashes, and ASCII control characters are refused by the preview schema.

### Declared deviation: JPEG

Issue #29 proposed PNG or JPEG input. This first packet-only slice accepts PNG and explicitly refuses JPEG. Renderprove already owns a bounded deterministic PNG decoder/encoder. Adding JPEG safely requires a reviewed decoder with decoded-pixel limits and deterministic metadata-free re-encoding; silently preserving JPEG scan data would fall short of the decode/re-encode requirement. JPEG support belongs in a focused follow-up before live provider execution.

## Cloudflare capability research

Research performed against Cloudflare documentation on 27 July 2026:

- Workers AI currently lists several vision-capable models, including `@cf/google/gemma-4-26b-a4b-it`, `@cf/meta/llama-4-scout-17b-16e-instruct`, and `@cf/meta/llama-3.2-11b-vision-instruct`.
- Cloudflare's own image-to-Markdown pipeline sends image data to `@cf/google/gemma-4-26b-a4b-it`.
- The generic OpenAI-compatible documentation describes `/v1/chat/completions`, while model pages and Cloudflare changelogs also support native `/ai/run`. The exact image wire shape should be verified with one secret-gated spike before the provider PR.
- `@cf/meta/llama-3.2-11b-vision-instruct` requires a one-time Meta licence acceptance request, which complicates unattended setup.
- `@cf/google/gemma-3-12b-it` is deprecated; the existing text Gemma assumption must not be reused for image input.

Current recommendation for the second PR: evaluate `@cf/google/gemma-4-26b-a4b-it` first, use the fixed native `/ai/run` endpoint, pin the exact request/response schema, disable streaming, request deterministic sampling where supported, cap response bytes and timeouts, and validate normalized advice locally. No provider code is included here.

Sources:

- https://developers.cloudflare.com/workers-ai/models/
- https://developers.cloudflare.com/ai/models/%40cf/google/gemma-4-26b-a4b-it/
- https://developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct/
- https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/
- https://developers.cloudflare.com/workers-ai/features/markdown-conversion/how-it-works/

## SmolRunner handoff design

The merged SmolRunner verification-profile contract provides the vocabulary needed for a later `renderprove.vision-check` profile:

- profile ID: `renderprove.vision-check`;
- repository command ID: `renderprove.vision-check.v1`;
- command contract digest: bind the reviewed Renderprove command specification and fixed argv layout;
- exact verification/build scope: one sparse advisory packet, with no package/workspace widening;
- typed evidence: one screenshot path, one brief path, and optional receipt path;
- immutable source identity: exact Renderprove and project commit/tree identities;
- required capabilities: Renderprove executable, Node runtime, readable enrolled workspace;
- resources: bounded CPU, memory, timeout, and exported artifact bytes;
- authority: read-only workspace, no local commit, no publication, no package installation, no arbitrary shell, no generic attachments;
- network: absent for dry-run; provider-only in a later phase;
- credentials: visible only to the provider subprocess;
- result identity: request digest, exact command identity, input identities, disposition, and exported normalized advice/receipt hashes.

Private workspace roots stay private evidence. Public SmolRunner results should carry project-relative identities and hashes only. Executable adapter work belongs in the SmolRunner repository after the Renderprove argv and digest contract merge.

## Fixture and workflow coverage

Required CI stays credentialless and network-free. `tests/vision-request.test.mjs` covers the packet and CLI baseline. `tests/vision-request-adversarial.test.mjs` adds a deterministic raster fixture with prompt-injection text drawn into pixels, PNG-container refusal cases, request-digest sensitivity and excluded-field invariance, preview-schema validation, and strict public `project://` identity cases. A later live-provider test should remain manual or secret-gated.
