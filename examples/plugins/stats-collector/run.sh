#!/bin/sh
set -eu

work="${PIPELINE_WORKSPACE:-.}"
in="$work/input"
out="$work/output"
mkdir -p "$out"

# Read numbers from workspace/input/numbers. The executor writes the list
# either as a JSON array (preferred) or as plain lines.
raw=$(cat "$in/numbers" 2>/dev/null || echo "")
# Strip a possible [ ] JSON wrapper, quotes and commas
nums=$(printf '%s' "$raw" | tr -d '[]"' | tr ',' '\n' | tr -s ' \n' '\n' | grep -v '^$' || true)
if [ -z "$nums" ]; then
  cat > "$work/error.json" <<EOF
{"code":"INPUT_EMPTY","message":"numbers list is empty"}
EOF
  exit 1
fi

export out
export out
echo "$nums" | awk 'BEGIN{n=0; s=0; mn=1e308; mx=-1e308}
{ n++; s+=$1; if($1<mn)mn=$1; if($1>mx)mx=$1; v[n]=$1 }
END{
  if(n>0){
    avg=s/n
    if(n>1){
      var=0
      for(i=1;i<=n;i++) var+=(v[i]-avg)^2
      var=var/(n-1)
    } else { var=0 }
    printf "%d\n", n > (ENVIRON["out"] "/count.json")
    printf "%.4f\n", s > (ENVIRON["out"] "/sum.json")
    printf "%.4f\n", avg > (ENVIRON["out"] "/avg.json")
    printf "%.4f\n", mn > (ENVIRON["out"] "/min.json")
    printf "%.4f\n", mx > (ENVIRON["out"] "/max.json")
  }
}'

# JSON bundle (legacy stats.json)
cat > "$out/stats.json" <<EOF
{"count":$(cat "$out/count.json"),"sum":$(cat "$out/sum.json"),"avg":$(cat "$out/avg.json"),"min":$(cat "$out/min.json"),"max":$(cat "$out/max.json")}
EOF

echo "stats: n=$(cat "$out/count.json")"
