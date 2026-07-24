# Receipt v1

A Renderprove receipt is evidence for a bounded review, not a universal proof that an interface is correct.

## Top-level fields

- `$schema`: canonical schema identifier
- `version`: receipt contract version
- `project`: manifest project identity
- `source`: manifest and project-root provenance
- `target`: reviewed base URL
- `startedAt`, `finishedAt`, `durationMs`
- `status`: `passed` or `failed`
- `summary`: case and diagnostic totals
- `runtime`: local process or remote-target details
- `cases`: route-by-viewport results

## Case evidence

Each case records:

- stable case ID
- route identity, requested URL, and final URL
- viewport dimensions and device scale
- navigation status
- page facts
- screenshot path, MIME type, and SHA-256
- timestamped diagnostics
- policy-derived status

## Compatibility

Consumers must reject unsupported major receipt versions. Additive fields may appear within version 1. Consumers should ignore unknown additive fields unless their own policy requires a closed schema.

## Privacy

Screenshots, URLs, console messages, and page text measurements may reveal private project information. Artifact storage and retention remain the caller's responsibility. Stensibly should store references and provenance rather than copying receipt contents by default.
