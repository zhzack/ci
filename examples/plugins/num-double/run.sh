#!/bin/sh
set -eu
work="${PIPELINE_WORKSPACE:-.}"
inp="$work/input"
out="$work/output"
mkdir -p "$out"
val=$(cat "$inp/value" 2>/dev/null || echo "0")
factor=$(cat "$inp/factor" 2>/dev/null || echo "2")
result=$(awk "BEGIN { print $val * $factor }")
echo "$result" > "$out/result.json"
echo "double($val * $factor) = $result"
