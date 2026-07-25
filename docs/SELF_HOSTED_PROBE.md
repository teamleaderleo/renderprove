# Self-hosted renderer probe

This probe runs Renderprove inside one disposable rootless Podman container in the existing Linux VM. It is an early proving path for trusted repository revisions, not a hostile-code sandbox or a replacement for SmolRunner.

## Boundary

```text
macOS
  -> Lima Ubuntu guest
  -> rootless Podman worker container
  -> repository-declared local process
  -> Playwright Chromium
  -> worker identity, screenshots, and receipt
```

The first slice keeps the reviewed app process and Chromium inside the same disposable container. Outbound networking is disabled. The app may use loopback only. The project directory is the sole writable bind mount, and the probe applies CPU, memory, PID, capability, and temporary-filesystem limits.

SmolRunner remains responsible for the eventual GitHub runner lifecycle, disposable project execution, ownership, and cleanup policy. Renderprove remains responsible for the browser review and evidence contract.

## Prerequisites

Run this from a Linux checkout inside the Lima guest:

- rootless Podman
- Node.js 22 or newer
- enough free disk to pull and build the pinned Playwright image
- a trusted Renderprove checkout

The existing `smolrunner` Lima profile is a suitable lab guest because it has no host mounts, port forwards, SSH-agent forwarding, or inherited proxy environment.

## Run the fixture probe

```bash
npm ci --ignore-scripts
npm run probe:podman
```

The command builds `localhost/renderprove-worker:probe`, records the renderer identity, and reviews `tests/fixtures/site` with networking disabled.

Evidence is written beneath:

```text
tests/fixtures/site/.renderprove-probe/
  worker.json
  review.stdout.json
  receipt.json
  screenshots/
```

To review another project already prepared inside the Renderprove checkout:

```bash
bash scripts/probe-podman.sh path/to/project
```

The project must contain `renderprove.json` or `.renderprove.json`. Its runtime command must work with the dependencies already present in that project directory. Dependency installation and production builds remain repository-owned preparation steps.

`RENDERPROVE_PROBE_OUTPUT` selects another project-relative evidence directory. `RENDERPROVE_PROBE_BUILD=0` reuses the previously built image. Both settings are validated before execution.

## Prove repeated convergence

```bash
npm run probe:repeatability
```

The repeatability probe builds the worker once, launches five fresh identity containers and five fresh review containers, then writes:

```text
tests/fixtures/site/.renderprove-repeatability/
  repeatability.json
  runs/
    001/
      worker.json
      review.stdout.json
      receipt.json
      screenshots/
    002/
    ...
```

`repeatability.json` records:

- each run name and receipt status;
- a canonical SHA-256 fingerprint of every worker identity;
- the union of case IDs observed across all runs;
- each case status and screenshot digest per run;
- missing cases or screenshots;
- stable and drifting case counts;
- one overall pass or fail result.

The command exits with `1` when any receipt fails, renderer fingerprints differ, a case is absent, a screenshot is missing, or screenshot digests differ. Invalid inputs and unreadable evidence exit with `2`.

Override the run count for a focused check:

```bash
RENDERPROVE_REPEAT_RUNS=3 npm run probe:repeatability
```

The accepted range is two through twenty. The default stays at five for the proving matrix.

## Worker identity

`worker.json` records:

- local image reference, image ID, and available repository digest;
- Renderprove and Playwright versions;
- OS, kernel, architecture, and Node version;
- Chromium version;
- locale and timezone;
- a SHA-256 digest of the sorted font inventory.

The local image ID is enough to distinguish probe builds on one machine. Published workers should also use an immutable registry digest.

## Resource overrides

The probe defaults to a 2 GiB memory ceiling and two CPUs so it can run inside the current 3 GiB Lima guest. Override these when reviewing a larger application:

```bash
RENDERPROVE_PROBE_MEMORY=4g RENDERPROVE_PROBE_CPUS=3 npm run probe:podman
```

Increasing the Lima guest to 8 GiB is recommended before reviewing a production Next.js build and Chromium in the same guest.

## Current limits

- trusted revisions only;
- one app process and renderer in one container;
- Chromium only;
- no dependency installation after outbound networking is disabled;
- screenshot equality is byte-exact, with no perceptual tolerance;
- no baseline approval or replacement;
- no authentication injection;
- no secret scanning or screenshot masking;
- no automatic GitHub runner registration;
- no SmolRunner mutation path.

The next slices should bind exact worker provenance into receipt v2, enrol a separately prepared application, then add baseline and perceptual-difference evidence.
