#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/../.." && pwd)"
generator="${repo_root}/.github/extensions/repository-architecture/generate-static.mjs"
test_directory="${repo_root}/.github/extensions/repository-architecture/test"
output="documentation/repository-architecture/index.html"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to refresh the repository architecture page." >&2
  exit 1
fi

cd "${repo_root}"

mapfile -t tests < <(find "${test_directory}" -maxdepth 1 -type f -name '*.test.mjs' -print | sort)
if [[ ${#tests[@]} -eq 0 ]]; then
  echo "No repository architecture tests were found." >&2
  exit 1
fi

node --test --test-concurrency=1 "${tests[@]}"
node "${generator}" \
  --repo-root "${repo_root}" \
  --output "${output}" \
  "$@"
