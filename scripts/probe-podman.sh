#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(CDPATH= cd -- "${script_dir}/.." && pwd)"
project_arg="${1:-tests/fixtures/site}"
image="${RENDERPROVE_WORKER_IMAGE:-localhost/renderprove-worker:probe}"
memory="${RENDERPROVE_PROBE_MEMORY:-2g}"
cpus="${RENDERPROVE_PROBE_CPUS:-2}"
build="${RENDERPROVE_PROBE_BUILD:-1}"
output="${RENDERPROVE_PROBE_OUTPUT:-.renderprove-probe}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'error: required command is unavailable: %s\n' "$1" >&2
    exit 2
  }
}

require_command podman
require_command node

case "${build}" in
  0|1) ;;
  *)
    printf 'error: RENDERPROVE_PROBE_BUILD must be 0 or 1\n' >&2
    exit 2
    ;;
esac

mapfile -d '' -t probe_paths < <(
  node "${script_dir}/probe-paths.mjs" "${repo_root}" "${project_arg}" "${output}"
)
if [ "${#probe_paths[@]}" -ne 4 ]; then
  printf 'error: unable to resolve enrolled project paths\n' >&2
  exit 2
fi
enrolled_root="${probe_paths[0]}"
project_root="${probe_paths[1]}"
evidence_root="${probe_paths[2]}"
container_output="${probe_paths[3]}"

playwright_version="$(cd "${repo_root}" && node -p "require('./package.json').dependencies.playwright")"
rm -rf -- "${evidence_root}"
mkdir -p -- "${evidence_root}"

if [ "${build}" -eq 1 ]; then
  printf 'Building %s with Playwright %s...\n' "${image}" "${playwright_version}"
  podman build \
    --build-arg "PLAYWRIGHT_VERSION=${playwright_version}" \
    --file "${repo_root}/build/worker/Containerfile" \
    --tag "${image}" \
    "${repo_root}"
else
  printf 'Reusing worker image %s...\n' "${image}"
fi

image_id="$(podman image inspect --format '{{.Id}}' "${image}")"
image_digest="$(podman image inspect --format '{{if .Digest}}{{.Digest}}{{end}}' "${image}" 2>/dev/null || true)"

common_args=(
  --rm
  --init
  --userns=keep-id
  --ipc=host
  --network=none
  --cap-drop=all
  --security-opt=no-new-privileges
  --pids-limit=768
  --memory="${memory}"
  --cpus="${cpus}"
  --tmpfs=/tmp:rw,nosuid,nodev,size=1g
)

printf 'Enrolled root: %s\n' "${enrolled_root}"
printf 'Recording renderer identity...\n'
podman run "${common_args[@]}" \
  --entrypoint node \
  --env "RENDERPROVE_WORKER_IMAGE=${image}" \
  --env "RENDERPROVE_WORKER_IMAGE_ID=${image_id}" \
  --env "RENDERPROVE_WORKER_IMAGE_DIGEST=${image_digest}" \
  "${image}" \
  /opt/renderprove/scripts/worker-identity.mjs \
  > "${evidence_root}/worker.json"

printf 'Reviewing %s...\n' "${project_root}"
podman run "${common_args[@]}" \
  --volume "${project_root}:/workspace/project:rw,Z" \
  "${image}" \
  review /workspace/project --output "${container_output}" --json \
  > "${evidence_root}/review.stdout.json"

printf 'Probe complete.\n'
printf 'Worker:  %s\n' "${evidence_root}/worker.json"
printf 'Receipt: %s\n' "${evidence_root}/receipt.json"
