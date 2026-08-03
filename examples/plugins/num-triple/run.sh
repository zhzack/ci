#!/bin/sh
set -eu
work="${PIPELINE_WORKSPACE:-.}"
inp="$work/input"
out="$work/output"
mkdir -p "$out"
val=$(cat "$inp/value" 2>/dev/null || echo "0")
result=$(awk "BEGIN { print $val * 3 }")
echo "$result" > "$out/result.json"
echo "triple($val) = $result"
