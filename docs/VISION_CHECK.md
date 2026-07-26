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

The screenshot is decoded with bounded pixel output and re-encoded as deterministic RGBA PNG. The public preview contains only project-relative identities, byte counts, dimensions, hashes, contract identities, included fact names, fixed exclusions, and the allowlisted receipt summary. Image bytes, brief contents, raw receipt content, raw diagnostics, target URLs, runtime commands, environment values, credentials, absolute paths, source files, lockfiles, workflows, dependency trees, and inferred repository files stay outside the preview.

The internal provider-neutral packet contains:

- schema identity `vision-request-v1`;
- stable command identity `renderprove.vision-check.v1` and its command-contract digest;
- prompt policy identity `vision-prompt-policy-v1`;
- canonicalization identity `rgba8-png-zlib9-v1`;
- `authority: advisory`;
- a fixed prompt policy;
- one canonical PNG identity plus dimensions and byte length;
- the canonical brief;
- an optional tiny receipt summary;
- a deterministic per-input SHA-256 request digest.

Canonical image bytes are private to the validated packet. They are not exposed as a mutable `Buffer`. A future provider adapter must obtain a fresh byte copy through `copyVisionImageBytes(packet)`, which rechecks the image hash, byte length, and request digest immediately before returning the copy.

### Prompt trust tiers

The fixed prompt policy gives inputs distinct roles:

1. the system policy controls authority, scope, and output purpose;
2. the operator brief supplies a bounded review focus inside that policy;
3. screenshot text and strings derived from browser evidence are untrusted evidence and cannot issue instructions;
4. the receipt disposition remains deterministic browser authority.

The operator brief cannot expand the input set, request secrets, change authority, alter browser disposition, or override the fixed policy. Future model output can advise; it cannot revise browser pass/fail state.

## Allowlisted receipt facts

Receipt-v1 currently permits these fields for the matched screenshot case:

- receipt and case dispositions;
- route name and query-free, fragment-free path;
- viewport name, width, height, and device scale factor;
- navigation status and `ok` disposition;
- counts of console, request, HTTP, page, and total diagnostics.

Diagnostic messages, URLs, page titles, body text, runtime commands, working directories, logs, and artifact paths are excluded. Receipt-v1 lacks typed interaction/check results and console severity, so this slice reports case disposition and diagnostic counts. A later receipt schema can add named checks through a separate reviewed allowlist.

## PNG canonicalization profile

`rgba8-png-zlib9-v1` accepts one still, non-interlaced, 8-bit PNG whose colour type is grayscale, RGB, grayscale with alpha, or RGBA. It decodes pixels and emits one metadata-free RGBA PNG using compression level 9.

The current profile refuses:

- APNG chunks (`acTL`, `fcTL`, and `fdAT`);
- a second concatenated PNG or known JPEG, GIF, or WebP image after `IEND`;
- duplicate `IEND` image endings;
- palette PNG;
- `tRNS` transparency;
- 16-bit samples;
- interlaced PNG;
- unsupported critical chunks;
- malformed chunks, CRC failures, decompression failures, and image bombs.

Unknown ancillary metadata and non-image trailing bytes may be present in the source but disappear during decode/re-encode.

## Bounds and refusal policy

- source image: at most 8,000,000 bytes;
- canonical image: at most 8,000,000 bytes;
- dimensions: at most 4,096 × 4,096;
- decoded pixels: at most 16,000,000;
- PNG chunks: at most 4,096;
- receipt: at most 256,000 bytes;
- URLs, stdin, directories, final-component symlinks, path escapes, control-character paths, multiple explicit values, malformed JSON, unsupported receipt schemas, unmatched receipt screenshots, and repository include options are refused.

Public file identities use percent-encoded `project://` segments. Traversal segments and percent-encoded control bytes are outside the schema.

### Declared deviation: JPEG

Issue #29 proposed PNG or JPEG input. This first packet-only slice accepts PNG and explicitly refuses JPEG. Renderprove already owns a bounded deterministic PNG decoder/encoder. Adding JPEG safely requires a reviewed decoder with decoded-pixel limits, deterministic orientation handling, multiple-picture refusal, and metadata-free re-encoding. JPEG support belongs in a focused follow-up before live provider execution.

## Cloudflare capability research

Research performed against Cloudflare documentation on 27 July 2026:

- Workers AI currently lists several vision-capable models, including `@cf/google/gemma-4-26b-a4b-it`, `@cf/meta/llama-4-scout-17b-16e-instruct`, and `@cf/meta/llama-3.2-11b-vision-instruct`.
- Cloudflare's own image-to-Markdown pipeline sends image data to `@cf/google/gemma-4-26b-a4b-it`.
- The generic OpenAI-compatible documentation describes `/v1/chat/completions`, while model pages and Cloudflare changelogs also support native `/ai/run`. The exact image wire shape should be verified with one secret-gated synthetic spike before the provider PR.
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
- command-contract digest: stable identity for the reviewed command specification, fixed argv, prompt policy, canonicalization profile, limits, receipt allowlist, and exclusions;
- request digest: per-run evidence identity for the selected screenshot, brief, and allowlisted receipt summary;
- exact verification/build scope: one sparse advisory packet, with no package/workspace widening;
- typed evidence: one screenshot path, one brief path, and optional receipt path;
- immutable source identity: exact Renderprove and project commit/tree identities;
- required capabilities: Renderprove executable, Node runtime, readable enrolled workspace;
- resources: bounded CPU, memory, timeout, and exported artifact bytes;
- authority: read-only workspace, no local commit, no publication, no package installation, no arbitrary shell, no generic attachments;
- network: absent for dry-run; provider-only in a later phase;
- credentials: visible only to the provider subprocess;
- result identity: both digests, exact command identity, input identities, disposition, and exported normalized advice/receipt hashes.

The command-contract digest must not vary with each screenshot. The request digest must vary when canonical pixels, the canonical brief, or allowlisted receipt facts vary. Changes limited to excluded receipt strings do not change the request digest.

Private workspace roots stay private evidence. Public SmolRunner results should carry project-relative identities and hashes only. Executable adapter work belongs in the SmolRunner repository after the Renderprove argv and command-contract digest merge.

## Fixture and workflow coverage

Required CI stays credentialless and network-free. `tests/vision-request.test.mjs` creates tiny deterministic images and receipts in temporary directories and covers:

- visibly rasterized prompt-injection text;
- canonical encoding and metadata/trailing-data removal;
- packet byte-copy integrity;
- APNG and concatenated-image refusal;
- public preview privacy and JSON Schema validation;
- digest sensitivity for pixels, brief text, and allowlisted receipt facts;
- digest invariance for excluded receipt strings;
- bounds, path containment, control characters, symlinks, image bombs, malformed inputs, receipt matching, and CLI refusal of repository includes.

A later live-provider test should remain manual or secret-gated.
