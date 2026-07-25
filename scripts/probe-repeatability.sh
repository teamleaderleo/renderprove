#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(CDPATH= cd -- "${script_dir}/.." && pwd)"
project_arg="${1:-tests/fixtures/site}"
runs="${RENDERPROVE_REPEAT_RUNS:-5}"
output="${RENDERPROVE_REPEAT_OUTPUT:-.renderprove-repeatability}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'error: required command is unavailable: %s\n' "$1" >&2
    exit 2
  }
}

require_command bash
require_command node
require_command seq

case "${runs}" in
  ''|*[!0-9]*)
    printf 'error: RENDERPROVE_REPEAT_RUNS must be an integer\n' >&2
    exit 2
    ;;
esac
if [ "${runs}" -lt 2 ] || [ "${runs}" -gt 20 ]; then
  printf 'error: RENDERPROVE_REPEAT_RUNS must be between 2 and 20\n' >&2
  exit 2
fi

mapfile -d '' -t probe_paths < <(
  node "${script_dir}/probe-paths.mjs" "${repo_root}" "${project_arg}" "${output}"
)
if [ "${#probe_paths[@]}" -ne 4 ]; then
  printf 'error: unable to resolve enrolled project paths\n' >&2
  exit 2
fi
project_root="${probe_paths[1]}"
repeat_root="${probe_paths[2]}"

rm -rf -- "${repeat_root}"
mkdir -p -- "${repeat_root}/runs"

for index in $(seq 1 "${runs}"); do
  run_name="$(printf '%03d' "${index}")"
  build=0
  if [ "${index}" -eq 1 ]; then build=1; fi
  printf '\n== repeatability run %s/%s ==\n' "${index}" "${runs}"
  RENDERPROVE_PROBE_BUILD="${build}" \
  RENDERPROVE_PROBE_OUTPUT="${output}/runs/${run_name}" \
    bash "${script_dir}/probe-podman.sh" "${project_arg}"
done

report_tmp="${repeat_root}/repeatability.json.tmp"
report_path="${repeat_root}/repeatability.json"
set +e
node "${script_dir}/repeatability-report.mjs" "${repeat_root}" > "${report_tmp}"
status=$?
set -e
mv -- "${report_tmp}" "${report_path}"

printf '\nProject: %s\n' "${project_root}"
printf 'Repeatability report: %s\n' "${report_path}"
node -e "const value=require(process.argv[1]); console.log('Status: ' + value.status + '; stable cases: ' + value.summary.stableCases + '/' + value.summary.cases)" "${report_path}"
exit "${status}"
