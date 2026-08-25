# Cloudflare Gemma 4 authenticated vision spike status

Status: blocked before provider transfer on 27 July 2026.

This note separates the attempted authenticated experiment from the documentation-confirmed capability research in `cloudflare-gemma4-vision-advisory-findings.md`.

## Attempted experiment

Three secret-gated GitHub Actions runs were started from draft PR #34. Each run completed repository checkout, Node setup, dependency installation, and Chromium installation, then entered the generated-image spike step.

| Run ID | Generated-image step | Cloudflare requests sent | Provider responses received | Failure class |
| --- | --- | ---: | ---: | --- |
| `30219973211` | started | 0 | 0 | `credentials-unavailable` |
| `30220013174` | started | 0 | 0 | `credentials-unavailable` |
| `30220139311` | started | 0 | 0 | `credentials-unavailable` |

The runner required these existing credential-boundary names:

- `CLOUDFLARE_ACCOUNT_ID`;
- `CLOUDFLARE_API_TOKEN`.

Both values were unavailable to the Actions job. The runner rejected the empty credential state before generating a provider request or opening a Cloudflare connection.

## Bounded empirical record

```json
{
  "schemaVersion": "cloudflare-vision-wire-spike-attempt-v1",
  "observedAt": "2026-07-27",
  "attempts": 3,
  "generatedImageStepReached": true,
  "providerRequestCount": 0,
  "providerResponseCount": 0,
  "failureClass": "credentials-unavailable",
  "privateDataRecorded": false,
  "privateCaptureRetained": false
}
```

No image bytes, data URI, prompt, brief, provider request body, headers, credentials, raw response, reasoning content, private path, or receipt content was committed or retained.

## Empirical questions that remain open

Because no provider request crossed the credential boundary, the experiment produced no evidence about:

- acceptance of the PNG data URI through either API style;
- image input combined with strict JSON Schema output;
- image input combined with a forced function call;
- thinking-off and thinking-enabled behaviour;
- finish reasons, usage metadata, request IDs, or system fingerprints;
- fixed-seed repeatability;
- provider timeout and practical response-size behaviour.

Issue #32 remains open until a credentialed rerun resolves these questions.

## Exactly one provisional adapter direction

Pending the authenticated rerun, the narrowest documentation-backed direction is:

- **endpoint/API style:** model-specific native Workers AI route, `POST /client/v4/accounts/{account_id}/ai/run/@cf/google/gemma-4-26b-a4b-it`;
- **structured-output mechanism:** one forced `emit_vision_advice` function call, with parallel tool calls disabled and local strict validation of its arguments.

This choice is provisional. It pins the model in the URL, fits Renderprove's existing Cloudflare boundary, avoids a generic compatibility client, and relies on Gemma 4's declared function-calling capability. Cloudflare's current JSON Mode supported-model guidance does not explicitly name Gemma 4, so JSON Schema output remains the weaker first choice until the live probe proves otherwise.

Production adapter code and a provider-adapter issue remain gated on a successful authenticated run plus the packet and advice-contract merge gates in PRs #30 and #35.
