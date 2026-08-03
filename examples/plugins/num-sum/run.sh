#!/bin/sh
set -eu
work="${PIPELINE_WORKSPACE:-.}"
inp="$work/input"
out="$work/output"
mkdir -p "$out"
# Read values: JSON array like [42.0, 84.0, 126.0]
raw=$(cat "$inp/values" 2>/dev/null || echo "[]")
# strip brackets and sum
nums=$(echo "$raw" | tr -d '[]"' | tr ',' '\n' | grep -v '^$' || echo "0")
total=0
for n in $nums; do
  total=$(awk "BEGIN { print $total + $n }")
done
echo "$total" > "$out/sum.json"
echo "sum($nums) = $total"
