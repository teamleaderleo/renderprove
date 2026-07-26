# Optional AI advisory review

Renderprove can send a bounded, sanitized set of project files and the latest browser receipt to Cloudflare Workers AI for a secondary review. The deterministic browser receipt remains authoritative. AI output is a separate `advice-v1` artifact and never changes browser pass/fail.

The default model is `@cf/google/gemma-4-26b-a4b-it`. Renderprove uses Cloudflare's native `/ai/run/{model}` endpoint with one required `report_advice` function call, low reasoning effort, and Node's built-in `fetch`; no provider SDK is required.

## Quick start

Run the deterministic review first:

```bash
npx renderprove review
```

Inspect the exact sanitized bundle, questions, exclusions, and conservative Neuron estimate without sending data:

```bash
npx renderprove advise --dry-run
npx renderprove advise --dry-run --json > /tmp/renderprove-advice-input.json
```

For a live review:

```bash
export CLOUDFLARE_ACCOUNT_ID='your-account-id'
export CLOUDFLARE_API_TOKEN='your-workers-ai-token'
npx renderprove advise
```

The result and run status are written beside the browser receipt by default:

```text
.renderprove/advice.json
.renderprove/advice-status.json
```

## Project-owned policy

Add `renderprove-advice.json` or `.renderprove-advice.json` to make the review focused and predictable:

```json
{
  "version": 1,
  "mode": "targeted",
  "questions": [
    "Can an interaction leave displayed state inconsistent with retained history?",
    "Do the observed browser facts contradict the declared expectations?"
  ],
  "include": [
    "src",
    "renderprove.json"
  ],
  "exclude": [
    "**/*.generated.js",
    "docs/archive/**"
  ],
  "limits": {
    "maxFiles": 32,
    "maxBytes": 160000,
    "maxFileBytes": 64000,
    "timeoutMs": 120000
  },
  "budget": {
    "dailyNeurons": 10000,
    "maxEstimatedNeurons": 1000,
    "onExceed": "skip",
    "contact": "@teamleaderleo"
  },
  "cache": {
    "reuse": true
  }
}
```

Command-line `--include`, `--model`, and limit options override the corresponding project policy for one run. Use `--advice-config path` when a repository keeps the policy under another name.

### Defaults

Without a policy file, Renderprove uses targeted mode, a conservative 1,000-Neuron per-run ceiling, a 10,000-Neuron daily planning guide, and exact-digest cache reuse.

Common lockfiles are excluded by default because they often dominate small review bundles while contributing little to UI-state or browser-evidence questions. Set:

```json
{ "version": 1, "includeLockfiles": true }
```

for dependency, supply-chain, or package-resolution reviews that genuinely need them.

The daily value is a planning guide, not shared account-wide accounting. Stateless CI runners cannot safely coordinate a Cloudflare account's daily usage by themselves. Cloudflare's own plan limit remains the account-wide authority; Renderprove prevents one unexpectedly broad request from consuming a disproportionate share.

## Budget and cache behaviour

Renderprove estimates input conservatively from sanitized bytes and reserves the full 4,096-token completion ceiling. Before a provider call it compares that estimate with `budget.maxEstimatedNeurons`.

- `onExceed: "skip"` writes `advice-status.json` with `status: "skipped"` and exits successfully.
- `onExceed: "error"` writes the same status and returns an execution failure.
- `budget.contact` is retained in the status so CI can tell an agent or operator whom to ask before widening the budget.

An existing `advice.json` is reused only when the complete sanitized evidence and normalized policy have the same SHA-256 digest. Questions, model selection, inclusions, exclusions, limits, and budget settings are included in that digest through a generated policy evidence entry. Changing any of them forces a fresh provider call.

## Data boundary

`renderprove advise` is an explicit external data transfer. It sends the sanitized bundle to the configured Cloudflare account.

Before transfer, Renderprove:

- resolves included paths beneath the real project root;
- rejects path escapes and symlinked policy files;
- skips symlinks, binary files, common build outputs, dependencies, evidence directories, secret-like filenames, and lockfiles unless enabled;
- redacts private-key blocks, common token and password assignments, bearer tokens, GitHub tokens, and embedded URL credentials;
- caps files and bytes;
- labels every omitted file and reason.

Secret detection is a guardrail rather than complete data-loss prevention. Inspect `--dry-run --json` before enabling advisory review for a sensitive repository. Keep production credentials outside the checkout and browser receipt.

The stored `advice.json` contains file paths, sizes, digests, redaction counts, omissions, provider usage, and normalized findings. It does not retain transmitted source contents or the API token.

## Result contract

`advice.json` follows `schema/advice-v1.schema.json` and includes:

- `authoritative: false`;
- provider and model identity;
- the exact input bundle SHA-256 and per-file digests;
- `clear`, `concern`, or `unknown` verdict;
- bounded findings with severity, evidence paths, and recommendations;
- strengths and evidence gaps;
- generation settings and token usage when returned by Cloudflare.

`advice-status.json` records whether the optional result is `available`, `skipped`, or `unavailable`, plus the bundle digest and budget estimate. It is operational status, not a replacement for the versioned advisory result.

Generation uses temperature `0`, a fixed seed, low reasoning effort, one required function call, and a 4,096-token completion ceiling. Hosted model execution can still vary across requests, model revisions, and serving changes. Treat it as a sanity check, triage aid, or extra set of eyes.

## CI pattern

Keep browser review as the required gate. Run advisory review separately and retain both artifacts:

```yaml
- name: Browser evidence
  run: npx renderprove review

- name: Gemma advisory review
  continue-on-error: true
  env:
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
  run: npx renderprove advise

- if: always()
  uses: actions/upload-artifact@v4
  with:
    name: renderprove-evidence
    path: .renderprove
    include-hidden-files: true
```

For pull requests from forks, do not expose provider credentials. Use trusted branches, protected environments, or an operator-controlled follow-up workflow.

Screenshot and other image inputs remain deferred to a separate vision evidence contract. The next visual slice adds deterministic baseline comparison first, then sends only semantically ambiguous evidence to a model.
