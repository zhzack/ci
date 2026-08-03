#!/bin/sh
set -eu

work="${PIPELINE_WORKSPACE:-.}"
in="$work/input"
out="$work/output"
mkdir -p "$out"

values=$(awk 'BEGIN{
  for (i=0; i<ARGC; i++) print ARGV[i+1]
}' "$(cat $in/x)" "$(cat $in/y)" "$(cat $in/z)" "$(cat $in/quotient)")

# Sort desc
sorted=$(echo "$values" | sort -nr)
echo "$sorted" | head -1 > "$out/max.json"
echo "$sorted" | tail -1 > "$out/min.json"
echo "$sorted" | tr '\n' ',' | sed 's/,$/]/' | sed 's/^/[/' > "$out/ranked.json"

echo "ranked=$sorted"
