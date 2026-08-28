#!/bin/bash
# publish.sh — IMFL Tool Hub 发布脚本
# 将工具源码打包成 tar.gz，上传到制品仓，并自动更新 index.json 注册表。
#
# 用法:
#   publish.sh <tool> <channel> <version>      发布指定版本
#   publish.sh promote <tool> <version>        从 testing 提升到 stable
#   publish.sh status                          查看当前注册表
#
# 配置:
#   脚本会从 .publishrc 读取，也可通过环境变量覆盖:
#     TOOLHUB_HUB         制品仓地址
#     TOOLHUB_AUTH        HTTP Basic Auth
#
# 版本号规范:
#   正式版: v1.0.0, v1.1.0  → stable
#   测试版: v1.1.0-beta.1, v1.1.0-rc.1 → testing

set -euo pipefail

# ── 解析配置 ──────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 尝试加载 .publishrc (相对于 SCRIPT_DIR 向上找 2 级: publish/publish.sh → tools-src/..publishrc)
if [ -f "$SCRIPT_DIR/../.publishrc" ]; then
    source "$SCRIPT_DIR/../.publishrc"
elif [ -f "$SCRIPT_DIR/../../.publishrc" ]; then
    source "$SCRIPT_DIR/../../.publishrc"
fi

HUB="${TOOLHUB_HUB:-https://ciartifactory-prd.ap.immotors.com/artifactory/TEST/zz/tools}"
AUTH="${TOOLHUB_AUTH:-user_download:Hsx2022@}"
# 源码根目录: toolhub 运行时有 IMFL_PRJ_ROOT, 直接运行时 fallback 脚本上层目录
SRC_ROOT="${IMFL_PRJ_ROOT:-${SCRIPT_DIR}/..}"

_curl_auth() {
    curl -fsSL -u "$AUTH" "$@"
}

# ── 帮助 ──────────────────────────────────────────────────────────

usage() {
    cat >&2 << 'EOF'
Usage:
  publish.sh <tool> <channel> <version>     发布指定版本
  publish.sh promote <tool> <version>       从 testing 提升到 stable
  publish.sh status                         查看当前注册表

Environment:
  TOOLHUB_HUB         制品仓地址
  TOOLHUB_AUTH        HTTP Basic Auth
EOF
    exit 1
}

# ── 发布 ──────────────────────────────────────────────────────────

cmd_publish() {
    local tool="$1" channel="$2" version="$3"
    local src_dir="${SRC_ROOT}/${tool}"
    local output="${tool}-${version}.tar.gz"
    local artifact_path="${tool}/${channel}/${version}/${output}"

    if [ ! -d "$src_dir" ]; then
        echo "ERROR: source directory not found: $src_dir" >&2
        exit 2
    fi

    # 1. 打包
    echo "[publish] packaging ${tool} ${version} from ${src_dir}..." >&2
    tar -czf "$output" \
        --exclude='__pycache__' \
        --exclude='*.pyc' \
        --exclude='*.pyo' \
        --exclude='.git' \
        --exclude='.DS_Store' \
        --exclude='Thumbs.db' \
        --exclude='.publishrc' \
        -C "$src_dir" .

    # 2. 上传 tar.gz
    local upload_url="${HUB}/${artifact_path}"
    echo "[publish] uploading to ${upload_url}..." >&2
    _curl_auth -T "$output" "$upload_url" || {
        echo "ERROR: upload failed (check credentials or network)" >&2
        rm -f "$output"
        exit 1
    }
    rm -f "$output"

    # 3. 更新 index.json (不存在则自动创建)
    local index_url="${HUB}/index.json"
    local tmp_index
    tmp_index=$(mktemp /tmp/toolhub_index_XXXXXX)

    echo "[publish] updating index.json..." >&2
    local _http_code
    _http_code=$(curl -sS -u "$AUTH" -w "%{http_code}" -o "$tmp_index" "$index_url" 2>/dev/null || echo "000")

    if [ "$_http_code" = "404" ]; then
        echo "[publish] index.json not found, creating new..." >&2
        echo '{"version":1,"tools":{}}' > "$tmp_index"
    elif [ "$_http_code" != "200" ]; then
        echo "ERROR: cannot fetch index.json (HTTP $_http_code)" >&2
        rm -f "$tmp_index"
        exit 1
    fi

    # 更新 index.json：读取 plugin.yaml 元信息，合并进注册表
    export TH_SRC_DIR="$src_dir" TH_TOOL="$tool" TH_CHANNEL="$channel" TH_VERSION="$version" TH_ARTIFACT_PATH="$artifact_path" TH_PARSER_DIR="$SCRIPT_DIR"
    python3 - "$tmp_index" << 'PYEOF'
import json, sys, os, re

# 复用同目录下的极简 plugin.yaml 解析器（从 TH_PARSER_DIR 定位）
sys.path.insert(0, os.environ['TH_PARSER_DIR'])
from parse_yaml import parse_plugin_yaml

tmp_index = sys.argv[1]
with open(tmp_index) as f:
    idx = json.load(f)

SRC_DIR = os.environ.get('TH_SRC_DIR', '')
TOOL = os.environ.get('TH_TOOL', '')
CHANNEL = os.environ.get('TH_CHANNEL', '')
VERSION = os.environ.get('TH_VERSION', '')
ARTIFACT_PATH = os.environ.get('TH_ARTIFACT_PATH', '')

meta = parse_plugin_yaml(os.path.join(SRC_DIR, 'plugin.yaml'))

# 将嵌套的 plugin.yaml 扁平化为 toolhub.sh 需要的 index.json 结构
t = idx.setdefault('tools', {}).setdefault(TOOL, {})
if meta.get('description') is not None:
    t['description'] = meta['description']
if isinstance(meta.get('runtime'), dict):
    if meta['runtime'].get('type'):
        t['runtime'] = meta['runtime']['type']
    if meta['runtime'].get('entry'):
        t['entry'] = meta['runtime']['entry']
if isinstance(meta.get('toolhub'), dict) and isinstance(meta['toolhub'].get('env'), dict):
    t['env'] = meta['toolhub']['env']
t.setdefault('name', TOOL)
t.setdefault('type', 'tar')
# 版本号去掉前导 v，保持与 plugin.yaml 一致
version_norm = VERSION[1:] if VERSION.startswith('v') else VERSION
if t.get('version', '') != version_norm:
    t['version'] = version_norm

ch = t.setdefault('channels', {}).setdefault(CHANNEL, [])
ch = [e for e in ch if e['version'] != VERSION]
ch.insert(0, {'version': VERSION, 'artifact': ARTIFACT_PATH})
t['channels'][CHANNEL] = ch

with open(tmp_index, 'w') as f:
    json.dump(idx, f, indent=2, ensure_ascii=False)
    f.write('\n')
PYEOF
    RET=$?
    if [ "$?" -ne 0 ]; then
        echo "ERROR: failed to update index.json" >&2
        rm -f "$tmp_index"
        exit 1
    fi

    _curl_auth -T "$tmp_index" "$index_url" || {
        echo "ERROR: failed to upload index.json" >&2
        rm -f "$tmp_index"
        exit 1
    }

    rm -f "$tmp_index"
    echo "[publish] done: ${tool} ${channel} ${version}" >&2
}

# ── 提升 (testing → stable) ───────────────────────────────────────

cmd_promote() {
    local tool="$1" version="$2"
    local index_url="${HUB}/index.json"
    local tmp_index
    tmp_index=$(mktemp /tmp/toolhub_index_XXXXXX)

    echo "[publish] fetching index.json..." >&2
    local _http_code
    _http_code=$(curl -sS -u "$AUTH" -w "%{http_code}" -o "$tmp_index" "$index_url" 2>/dev/null || echo "000")

    if [ "$_http_code" = "404" ]; then
        echo "ERROR: index.json not found — cannot promote without existing registry" >&2
        rm -f "$tmp_index"
        exit 1
    elif [ "$_http_code" != "200" ]; then
        echo "ERROR: cannot fetch index.json (HTTP $_http_code)" >&2
        rm -f "$tmp_index"
        exit 1
    fi

    python3 -c "
import json,sys

with open('$tmp_index') as f:
    idx = json.load(f)

channels = idx['tools']['${tool}']['channels']
testing_list = channels.get('testing', [])

# 在 testing 中找该版本
found = None
for v in testing_list:
    if v['version'] == '${version}':
        found = v.copy()
        break

if not found:
    print('ERROR: version \"${version}\" not found in testing channel', file=sys.stderr)
    sys.exit(2)

# 保留原始 artifact 路径 (promote 不移动 tar.gz 物理文件)

# 去重后插入 stable 头部
stable_list = channels.setdefault('stable', [])
stable_list = [e for e in stable_list if e['version'] != '${version}']
stable_list.insert(0, found)
channels['stable'] = stable_list

with open('$tmp_index', 'w') as f:
    json.dump(idx, f, indent=2, ensure_ascii=False)
    f.write('\n')
" || {
        rm -f "$tmp_index"
        exit 1
    }

    echo "[publish] uploading updated index.json..." >&2
    _curl_auth -T "$tmp_index" "$index_url" || {
        echo "ERROR: failed to upload index.json" >&2
        rm -f "$tmp_index"
        exit 1
    }

    rm -f "$tmp_index"
    echo "[publish] promoted: ${tool} ${version} testing → stable" >&2
}

# ── 查看状态 ──────────────────────────────────────────────────────

cmd_status() {
    local index_url="${HUB}/index.json"
    echo "[publish] registry: ${index_url}" >&2

    local _tmp; _tmp=$(mktemp /tmp/toolhub_status_XXXXXX)
    local _http_code
    _http_code=$(curl -sS -u "$AUTH" -w "%{http_code}" -o "$_tmp" "$index_url" 2>/dev/null || echo "000")

    if [ "$_http_code" = "404" ]; then
        echo "[publish] (no index.json yet — nothing published)" >&2
        rm -f "$_tmp"
        return
    elif [ "$_http_code" != "200" ]; then
        echo "ERROR: cannot fetch index.json (HTTP $_http_code)" >&2
        rm -f "$_tmp"
        exit 1
    fi

    echo >&2
    python3 -c "
import json,sys
with open('$_tmp') as f:
    idx = json.load(f)
for name, t in sorted(idx.get('tools',{}).items()):
    print('  [{}]  {}'.format(name, t.get('description','')))
    for ch in ['stable','testing']:
        vers = t.get('channels',{}).get(ch,[])
        if not vers:
            print('    {}: (empty)'.format(ch))
        else:
            print('    {}:'.format(ch))
            for v in vers:
                print('      {}  →  {}'.format(v['version'], v['artifact']))
    if set(t.get('channels',{}).keys()) - {'stable','testing'}:
        for ch in sorted(set(t.get('channels',{}).keys()) - {'stable','testing'}):
            vers = t.get('channels',{}).get(ch,[])
            print('    {}: {} versions'.format(ch, len(vers)))
    print()
"
    rm -f "$_tmp"
}

# ── 入口 ──────────────────────────────────────────────────────────

case "${1:-}" in
    promote)
        [ $# -eq 3 ] || usage
        cmd_promote "$2" "$3"
        ;;
    status|list)
        cmd_status
        ;;
    -h|--help|help)
        usage
        ;;
    "")
        usage
        ;;
    *)
        [ $# -eq 3 ] || usage
        cmd_publish "$1" "$2" "$3"
        ;;
esac
