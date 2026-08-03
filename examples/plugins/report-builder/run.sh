#!/bin/sh
set -eu

work="${PIPELINE_WORKSPACE:-.}"
in="$work/input"
out="$work/output"
mkdir -p "$out"

title=$(cat "$in/title")
sub=$(cat "$in/subtitle" 2>/dev/null || echo "")
count=$(cat "$in/count")
sum=$(cat "$in/sum")
avg=$(cat "$in/avg")
mx=$(cat "$in/max")
mn=$(cat "$in/min")

{
  echo "# $title"
  if [ -n "$sub" ]; then echo "*$sub*"; fi
  echo
  echo "| Metric  | Value  |"
  echo "|---------|--------|"
  echo "| Samples | $count |"
  echo "| Sum     | $sum   |"
  echo "| Average | $avg   |"
  echo "| Min     | $mn    |"
  echo "| Max     | $mx    |"
} > "$out/report.md"

report=$(cat "$out/report.md")
words=$(echo "$report" | wc -w)
echo "$words" > "$out/word_count.json"

echo "report generated: $words words"
