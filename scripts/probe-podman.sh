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
require_command realpath

case "${build}" in
  0|1) ;;
  *)
    printf 'error: RENDERPROVE_PROBE_BUILD must be 0 or 1\n' >&2
    exit 2
    ;;
esac
case "${output}" in
  /*|''|.|..|../*|*/../*|*/..)
    printf 'error: RENDERPROVE_PROBE_OUTPUT must be a project-relative directory\n' >&2
    exit 2
    ;;
esac

project_root="$(realpath -e -- "${repo_root}/${project_arg}")"
case "${project_root}" in
  "${repo_root}"|"${repo_root}"/*) ;;
  *)
    printf 'error: project must stay inside the Renderprove checkout: %s\n' "${project_root}" >&2
    exit 2
    ;;
esac

evidence_root="$(realpath -m -- "${project_root}/${output}")"
case "${evidence_root}" in
  "${project_root}"/*) ;;
  *)
    printf 'error: evidence output must stay inside the project: %s\n' "${evidence_root}" >&2
    exit 2
    ;;
esac
container_output="$(realpath --relative-to="${project_root}" "${evidence_root}")"

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
