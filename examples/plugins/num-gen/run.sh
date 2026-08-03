#!/bin/sh
set -eu
work="${PIPELINE_WORKSPACE:-.}"
out="$work/output"
mkdir -p "$out"
val=$(( (RANDOM % 100) + 1 ))
echo "$val" > "$out/value.json"
echo "Generated random value: $val"
