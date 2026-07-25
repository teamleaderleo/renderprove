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
  *.png
```

To review another project already prepared inside the Renderprove checkout:

```bash
bash scripts/probe-podman.sh path/to/project
```

The project must contain `renderprove.json` or `.renderprove.json`. Its runtime command must work with the dependencies already present in that project directory. Dependency installation and production builds remain repository-owned preparation steps.

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
- no baseline comparison;
- no authentication injection;
- no secret scanning or screenshot masking;
- no automatic GitHub runner registration;
- no SmolRunner mutation path.

The next slices should prove repeated screenshot convergence, then add exact worker provenance to a new receipt version, app preparation identity, and baseline comparison.
