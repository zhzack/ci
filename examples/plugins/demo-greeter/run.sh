#!/bin/sh
set -eu

work="${PIPELINE_WORKSPACE:-.}"
in="$work/input"
out="$work/output"
mkdir -p "$out"

greeting=$(cat "$in/greeting")
seed=$(cat "$in/seed" 2>/dev/null || echo "42")

phrases="Pipeline is humming along.|Your task landed safely on disk.|Artifacts uploaded to the managed store.|Logs are streaming in real time.|Mini Pipeline says hi from the shell runtime."

# Pick a phrase deterministically based on seed
phrase=$(echo "$phrases" | tr '|' '\n' | awk -v s="$seed" 'NR == (s % 5) + 1')

message="$greeting! $phrase"
echo "$message" > "$out/message.txt"
words=$(echo "$message" | wc -w)
echo "$words" > "$out/word_count.json"

echo "$message"
