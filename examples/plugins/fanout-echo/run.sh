#!/bin/sh
set -eu

work="${PIPELINE_WORKSPACE:-.}"
in="$work/input"
out="$work/output"
mkdir -p "$out"

message=$(cat "$in/message")
tag=$(cat "$in/tag" 2>/dev/null || echo "log")
final="[$tag] $message"

echo "$final" > "$out/echo.txt"
echo "$final" | wc -c > "$out/length.json"

# Optional metadata
cat > "$out/metadata.json" <<EOF
{"tag":"$tag","length":${#final}}
EOF

printf '%s\n' "$final"
