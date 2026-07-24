# Receipt v1

A Renderprove receipt is evidence for a bounded review, not a universal proof that an interface is correct.

## Top-level fields

- `$schema`: canonical schema identifier
- `version`: receipt contract version
- `project`: manifest project identity
- `source`: project-relative manifest provenance
- `target`: reviewed base origin
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

Receipt v1 is defined by `schema/receipt-v1.schema.json`. Consumers must reject unsupported receipt versions. Adding or removing schema fields requires a new receipt version rather than silently widening v1.

## Privacy

Screenshots, URLs, console messages, and page text measurements may reveal private project information. Absolute worker paths and successful runtime log contents are excluded from receipts. Artifact storage and retention remain the caller's responsibility. Stensibly should store references and provenance rather than copying receipt contents by default.
