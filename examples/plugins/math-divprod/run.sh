#!/bin/sh
set -eu

work="${PIPELINE_WORKSPACE:-.}"
in="$work/input"
out="$work/output"
mkdir -p "$out"

a=$(cat "$in/a")
b=$(cat "$in/b")
c=$(cat "$in/c")

product=$(awk "BEGIN{print $a*$b}")
if [ "$c" = "0" ]; then
  cat > "$work/error.json" <<EOF
{"code":"DIV_BY_ZERO","message":"c=0 (divisor must not be zero)"}
EOF
  echo "ERROR: division by zero (c=0)" >&2
  exit 1
fi
quotient=$(awk "BEGIN{print $a*$b/$c}")

echo "$product" > "$out/product.json"
echo "$quotient" > "$out/quotient.json"

echo "a=$a b=$b c=$c product=$product quotient=$quotient"
