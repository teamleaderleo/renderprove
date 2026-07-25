# Optional AI advisory review

Renderprove can send a bounded, sanitized set of project files and the latest browser receipt to Cloudflare Workers AI for a secondary review. The deterministic browser receipt remains authoritative. The AI result is a separate `advice-v1` artifact and never changes the browser review exit code.

The default model is `@cf/google/gemma-4-26b-a4b-it`, a Cloudflare-hosted Gemma model with a large context window. Renderprove uses Cloudflare's OpenAI-compatible chat-completions endpoint through Node's built-in `fetch`; no provider SDK is required.

## Quick start

Run the deterministic review first:

```bash
npx renderprove review
```

Inspect the exact sanitized bundle without sending data:

```bash
npx renderprove advise --dry-run
npx renderprove advise --dry-run --json > /tmp/renderprove-advice-input.json
```

Create a Workers AI API token and set the account values:

```bash
export CLOUDFLARE_ACCOUNT_ID='your-account-id'
export CLOUDFLARE_API_TOKEN='your-workers-ai-token'
npx renderprove advise
```

The result is written beside the receipt as `.renderprove/advice.json` by default.

## App ergonomics

A project with a normal `renderprove.json` needs no additional advisory configuration. The command automatically includes:

- the Renderprove manifest;
- `.renderprove/receipt.json` when present;
- common package, lock, documentation, source, configuration, style, and workflow files;
- a deterministic list of omissions and redactions.

Use repeated `--include` options to narrow a monorepo or focus the review:

```bash
npx renderprove advise --include src --include package.json --include README.md
```

Useful limits:

```bash
npx renderprove advise \
  --max-files 40 \
  --max-bytes 250000 \
  --max-file-bytes 64000 \
  --timeout 45000
```

The defaults are 64 files, 400,000 total sanitized bytes, 96,000 bytes per file, and a 60-second provider timeout.

## Data boundary

`renderprove advise` is an explicit external data transfer. It sends the sanitized bundle to the configured Cloudflare account.

Before transfer, Renderprove:

- resolves included paths beneath the real project root;
- rejects path escapes;
- skips symlinks, binary files, common build outputs, dependencies, evidence directories, and secret-like filenames;
- redacts private-key blocks, common token and password assignments, bearer tokens, GitHub tokens, and embedded URL credentials;
- caps files and bytes;
- labels every omitted file and reason.

Secret detection is a guardrail rather than a complete data-loss-prevention system. Always inspect `--dry-run --json` before enabling advisory review for a sensitive repository. Keep production credentials outside the checkout and receipt.

The stored `advice.json` contains file paths, sizes, digests, redaction counts, omissions, provider usage, and normalized findings. It does not retain the transmitted source contents or the API token.

## Result contract

The output follows `schema/advice-v1.schema.json` and includes:

- `authoritative: false`;
- provider and model identity;
- input bundle SHA-256 and per-file digests;
- `clear`, `concern`, or `unknown` verdict;
- bounded findings with severity, evidence paths, and recommendations;
- strengths and evidence gaps;
- generation settings and token usage when returned by Cloudflare.

Generation uses temperature `0` and a fixed seed to reduce variance. Hosted model execution can still vary across requests, model revisions, and serving changes. Treat the result as a sanity check, triage aid, or extra set of eyes.

## CI pattern

Keep the deterministic review as the required gate. Run the advisory step separately and retain its artifact:

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

## Cloudflare notes

Workers AI supports OpenAI-compatible chat completions. As of July 2026, Cloudflare lists Gemma 4 pricing at US$0.10 per million input tokens and US$0.30 per million output tokens, with a free daily Workers AI allocation measured in Neurons. Check Cloudflare's current model and pricing pages before relying on these figures.

Cloudflare also offers an asynchronous Batch API for larger offline workloads. The initial Renderprove command remains synchronous so a local operator or CI job receives one immediate advisory artifact. Screenshot and other image inputs are intentionally deferred to a later vision-specific evidence contract.
