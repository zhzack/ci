#!/bin/sh
set -eu
work="${PIPELINE_WORKSPACE:-.}"
inp="$work/input"
out="$work/output"
mkdir -p "$out"

input_file="$inp/input.txt"
if [ ! -f "$input_file" ]; then
  echo '{"code":"FILE_MISSING","message":"input.txt not found in workspace/input/"}' > "$work/error.json"
  exit 1
fi

lines=$(wc -l < "$input_file" | tr -d ' ')
words=$(wc -w < "$input_file" | tr -d ' ')

echo "$lines" > "$out/lines.json"
echo "$words" > "$out/words.json"
echo "file-counter: $lines lines, $words words"
