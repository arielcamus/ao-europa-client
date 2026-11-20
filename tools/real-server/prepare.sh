#!/usr/bin/env bash
# Apply only the reviewed adapter to the pinned, official community server.
set -euo pipefail
adapter_dir="$(cd "$(dirname "$0")" && pwd)"
server_dir="${1:?Usage: prepare.sh /path/to/lambdaclass-argentum}"
expected=1699a662e6352bfcc9ea5905c6d6f2c0157cb1e7
actual="$(git -C "$server_dir" rev-parse HEAD)"
if [[ "$actual" != "$expected" ]]; then
  echo "Expected server revision $expected; found $actual" >&2
  exit 1
fi
if git -C "$server_dir" apply --check "$adapter_dir/server.patch" 2>/dev/null; then
  git -C "$server_dir" apply "$adapter_dir/server.patch"
elif ! git -C "$server_dir" apply --reverse --check "$adapter_dir/server.patch"; then
  echo 'Adapter patch conflicts with local server changes.' >&2
  exit 1
fi
cp "$adapter_dir/classic_profile.ex" "$server_dir/server/apps/ao_tcp_gateway/lib/ao_tcp_gateway/classic_profile.ex"
echo "Classic adapter prepared for $expected (loopback listeners only)."
