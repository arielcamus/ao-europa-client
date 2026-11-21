#!/bin/bash
# Runs a windows-drive scenario, retrying while the server still thinks the character is online from the previous run.
for i in 1 2 3 4 5 6; do
  out=$(node tools/windows-drive.mjs "$@" 2>&1) && { echo "$out"; exit 0; }
  echo "$out" | grep -q "TimeoutError" || { echo "$out"; exit 1; }
  sleep 20
done
echo "$out"; exit 1
