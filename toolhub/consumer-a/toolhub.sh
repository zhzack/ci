#!/bin/bash
# toolhub.sh — IMFL Tool Hub 通用引导脚本
# 根据 index.json 注册表，从制品仓下载工具并运行。
#
# 用法:
#   ./toolhub.sh <tool> [--channel <name>] [tool args...]
#   ./toolhub.sh <tool>@<version> [--channel <name>] [tool args...]
#
# 环境变量:
#   TOOLHUB_HUB           制品仓地址
#   TOOLHUB_AUTH          HTTP Basic Auth (user:pass@)
#   IMFL_TOOL_CHANNEL     默认通道 (默认 stable)
#   IMFL_TOOL_OFFLINE    离线模式 (1=跳过所有网络请求, 仅用缓存)
#   IMFL_TOOL_CACHE       缓存根目录 (默认 ~/.cache/imfl-tools)
#   IMFL_PRJ_ROOT         项目根路径 (默认 toolhub.sh 所在目录)
#
# 版本解析规则:
#   sync              → stable 通道 → 取列表头部（最新版本）
#   sync@v1.0.0       → 遍历所有通道精确匹配
#   sync --channel testing → testing 通道 → 取列表头部（最新版本）

set -euo pipefail

if [ $# -eq 0 ]; then
    echo "Usage: $0 <tool>[@<version>] [--channel <name>] [tool args...]" >&2
    echo "       $0 <tool>[@<version>] [--channel <name>] [tool args...]" >&2
    exit 1
fi

# ── 解析 tool 名称和版本 ──────────────────────────────────────────

TOOL_SPEC="$1"; shift

if echo "$TOOL_SPEC" | grep -q '@'; then
    TOOL_NAME="${TOOL_SPEC%%@*}"
    TOOL_VERSION="${TOOL_SPEC#*@}"
else
    TOOL_NAME="$TOOL_SPEC"
    TOOL_VERSION=""
fi

# 解析 --channel 参数
CHANNEL="${IMFL_TOOL_CHANNEL:-stable}"
NEW_ARGS=()
while [ $# -gt 0 ]; do
    case "$1" in
        --channel)
            CHANNEL="$2"; shift 2 ;;
        *)
            NEW_ARGS+=("$1"); shift ;;
    esac
done
set -- "${NEW_ARGS[@]}"

# ── 配置 ─────────────────────────────────────────────────────────

HUB="${TOOLHUB_HUB:-https://ciartifactory-prd.ap.immotors.com/artifactory/TEST/zz/tools}"
AUTH="${TOOLHUB_AUTH:-user_download:Hsx2022@}"
CACHE="${IMFL_TOOL_CACHE:-$HOME/.cache/imfl-tools}"
PRJ_ROOT="${IMFL_PRJ_ROOT:-$(dirname "$(readlink -f "$0")")}"
INDEX_URL="${HUB}/index.json"
INDEX_CACHE="${CACHE}/.index_cache"
INDEX_TTL=300

mkdir -p "$CACHE"
export IMFL_PRJ_ROOT="$PRJ_ROOT"

# ── curl 封装 ─────────────────────────────────────────────────────

_curl() {
    curl -fsSL -u "$AUTH" "$@"
}

# ── 查找工具缓存目录（任意版本） ──────────────────────────────────

_find_any_cached_tool() {
    local tool="$1"
    local _d; _d=$(ls -dt "${CACHE}/${tool}"/v*/ 2>/dev/null | head -1)
    if [ -n "$_d" ] && [ -f "${_d}.extracted" ]; then
        echo "${_d%/}"
    fi
}

# ── 获取 index.json (带本地缓存 + 离线兜底) ───────────────────────

get_index() {
    local fresh=0 cache_age=0

    if [ -f "$INDEX_CACHE" ]; then
        cache_age=$(($(date +%s) - $(stat -c %Y "$INDEX_CACHE" 2>/dev/null || echo 0)))
        if [ "$cache_age" -lt "$INDEX_TTL" ]; then
            cat "$INDEX_CACHE"
            return 0
        fi
    fi

    # TTL 过期或首次: 尝试刷新
    if [ "${IMFL_TOOL_OFFLINE:-0}" != "1" ]; then
        mkdir -p "$(dirname "$INDEX_CACHE")"
        if _curl "$INDEX_URL" 2>/dev/null | tee "$INDEX_CACHE" 2>/dev/null; then
            return 0
        fi
    fi

    # 网络失败 / 离线模式 → 使用过期缓存兜底
    if [ -f "$INDEX_CACHE" ] && [ -s "$INDEX_CACHE" ]; then
        echo "[toolhub] WARN: using stale index cache (${cache_age}s old)" >&2
        cat "$INDEX_CACHE"
        return 0
    fi

    return 1
}

# ── 获取工具元信息 ────────────────────────────────────────────────

get_tool_meta() {
    local index="$1" tool="$2"
    echo "$index" | python3 -c "
import json,sys
d = json.load(sys.stdin)
t = d.get('tools',{}).get('${tool}')
if not t:
    print('ERROR: tool \"${tool}\" not found', file=sys.stderr)
    sys.exit(2)
print(json.dumps(t))
"
}

# ── 版本解析 ──────────────────────────────────────────────────────

resolve_version() {
    local meta="$1" channel="$2" ver="$3"

    if [ -n "$ver" ]; then
        echo "$meta" | python3 -c "
import json,sys
t = json.load(sys.stdin)
for ch, vers in t.get('channels',{}).items():
    for v in vers:
        if v['version'] == '${ver}':
            print(json.dumps(v))
            sys.exit(0)
print('ERROR: version \"${ver}\" not found in any channel', file=sys.stderr)
sys.exit(2)
"
    else
        echo "$meta" | python3 -c "
import json,sys
t = json.load(sys.stdin)
vers = t.get('channels',{}).get('${channel}',[])
if not vers:
    print('ERROR: no versions in channel \"${channel}\"', file=sys.stderr)
    sys.exit(2)
print(json.dumps(vers[0]))
"
    fi
}

# ── 主流程 ────────────────────────────────────────────────────────

INDEX=$(get_index) || {
    if [ "${IMFL_TOOL_OFFLINE:-0}" = "1" ]; then
        echo "[toolhub] ERROR: offline mode — no index.json cache available" >&2
        echo "[toolhub]        run once online to create cache, then retry with offline" >&2
        exit 1
    fi
    echo "[toolhub] ERROR: cannot fetch index.json and no local cache available" >&2
    INDEX=""
}

# index.json 不存在 (404) → 尝试本地 fallback
if [ -z "$INDEX" ] || ! echo "$INDEX" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
    _local_src=""
    for _try in "${PRJ_ROOT}/${TOOL_NAME}" "${PRJ_ROOT}/tools-src/${TOOL_NAME}"; do
        if [ -d "$_try" ]; then
            _local_src="$_try"
            break
        fi
    done
    if [ -d "$_local_src" ]; then
        echo "[toolhub] index.json not found, using local tools-src/${TOOL_NAME}/ ..." >&2
        # 优先读取 plugin.yaml（与发布时一致的描述文件）
        _local_runtime=""
        _local_entry=""
        if [ -f "$_local_src/plugin.yaml" ]; then
            # 解析出 runtime.type / runtime.entry / toolhub.env 三部分
            _local_meta=$(IMFL_PRJ_ROOT="$PRJ_ROOT" python3 - "$_local_src/plugin.yaml" << 'PYEOF'
import sys, os
p = sys.argv[1]
result = {}
env_vars = {}
if os.path.isfile(p):
    section = None
    sub = None
    for raw in open(p, encoding="utf-8"):
        line = raw.rstrip()
        if not line.strip() or line.strip().startswith("#"):
            continue
        content = line.strip()
        if content.startswith("contract") or content.startswith("inputs") or content.startswith("outputs"):
            section, sub = None, None
            continue
        indent = len(line) - len(line.lstrip())
        if indent == 0:
            section, sub = None, None
            if ":" in content:
                k, _, v = content.partition(":")
                k, v = k.strip(), v.strip()
                if v:
                    result[k] = v.strip('"').strip("'")
                else:
                    section = k
        elif indent == 2 and section in ("runtime", "toolhub") and ":" in content:
            k, _, v = content.partition(":")
            k, v = k.strip(), v.strip()
            if section == "runtime":
                result.setdefault("runtime", {})[k] = v.strip('"').strip("'")
            elif k == "env" and not v:
                sub = "env"
        elif indent >= 4 and section == "toolhub" and sub == "env" and ":" in content:
            k, _, v = content.partition(":")
            v = v.strip().strip('"').strip("'").replace("${IMFL_PRJ_ROOT}", os.environ.get("IMFL_PRJ_ROOT", ""))
            env_vars[k.strip()] = v
print("RUNTIME={}".format(result.get("runtime", {}).get("type", "")))
print("ENTRY={}".format(result.get("runtime", {}).get("entry", "")))
for k, v in env_vars.items():
    print("ENV:{}={}".format(k, v))
PYEOF
)
            while IFS= read -r _line; do
                case "$_line" in
                    RUNTIME=*) _local_runtime="${_line#RUNTIME=}" ;;
                    ENTRY=*)   _local_entry="${_line#ENTRY=}" ;;
                    ENV:*)     export "${_line#ENV:}" ;;
                esac
            done <<< "$_local_meta"
        fi
        if [ -z "$_local_entry" ]; then
            _find_entry() {
                for _try in run.sh main.sh; do
                    [ -f "$_local_src/$_try" ] && { echo "$_try"; return; }
                done
                # 找第一个 .sh 或 .py
                local _sh; _sh=$(ls "$_local_src"/*.sh 2>/dev/null | head -1)
                [ -n "$_sh" ] && { basename "$_sh"; return; }
                local _py; _py=$(ls "$_local_src"/*.py 2>/dev/null | head -1)
                [ -n "$_py" ] && { basename "$_py"; return; }
            }
            _local_entry=$(_find_entry)
        fi
        if [ -z "$_local_entry" ] || [ ! -f "$_local_src/$_local_entry" ]; then
            echo "[toolhub] ERROR: no entry found in $_local_src/" >&2
            exit 1
        fi
        export TOOLHUB_TOOL_NAME="$TOOL_NAME"
        export TOOLHUB_TOOL_VERSION="local"
        export TOOLHUB_TOOL_CHANNEL="local"
        case "$_local_runtime" in
            python|python3)  exec python3 "$_local_src/$_local_entry" "$@" ;;
            node)            exec node "$_local_src/$_local_entry" "$@" ;;
            executable|"")   if [ -x "$_local_src/$_local_entry" ]; then
                                 exec "$_local_src/$_local_entry" "$@"
                             else
                                 exec bash "$_local_src/$_local_entry" "$@"
                             fi ;;
            *)               exec bash "$_local_src/$_local_entry" "$@" ;;
        esac
    fi
    echo "[toolhub] ERROR: cannot fetch index.json and no local tools-src/${TOOL_NAME}/ found" >&2
    echo "[toolhub]        first time? run: bash tools-src/publish/publish.sh ${TOOL_NAME} stable v1.0.0" >&2
    exit 1
fi

TOOL_META=$(get_tool_meta "$INDEX" "$TOOL_NAME") || exit $?

RUNTIME=$(echo "$TOOL_META" | python3 -c "import json,sys; print(json.load(sys.stdin).get('runtime',''))")
ENTRY=$(echo "$TOOL_META" | python3 -c "import json,sys; print(json.load(sys.stdin).get('entry',''))")

if [ -z "$ENTRY" ]; then
    echo "[toolhub] ERROR: tool \"${TOOL_NAME}\" in index.json is missing required field 'entry'." >&2
    echo "[toolhub]        The tool was likely published without plugin.yaml support." >&2
    echo "[toolhub]        Re-publish it: ./toolhub.sh publish ${TOOL_NAME} stable <version>" >&2
    exit 2
fi
if [ -z "$RUNTIME" ]; then
    echo "[toolhub] ERROR: tool \"${TOOL_NAME}\" in index.json is missing required field 'runtime'." >&2
    exit 2
fi

VERSION_ENTRY=$(resolve_version "$TOOL_META" "$CHANNEL" "$TOOL_VERSION") || exit $?
VERSION=$(echo "$VERSION_ENTRY" | python3 -c "import json,sys; print(json.load(sys.stdin)['version'])")
ARTIFACT=$(echo "$VERSION_ENTRY" | python3 -c "import json,sys; print(json.load(sys.stdin)['artifact'])")

# ── 自更新: 工具名 "toolhub" ───────────────────────────────────────

if [ "$TOOL_NAME" = "toolhub" ]; then
    SELF_FILE=$(readlink -f "$0")
    TAR_URL="${HUB}/${ARTIFACT}"
    TMPD=$(mktemp -d /tmp/toolhub_update_XXXXXX)

    if [ "$TOOL_OFFLINE" = "1" ]; then
        echo "[toolhub] offline mode — skipping self-update" >&2
        exit 0
    fi

    echo "[toolhub] self-update to ${VERSION}..." >&2
    _curl "$TAR_URL" -o "${TMPD}/toolhub.tar.gz" || {
        echo "[toolhub] WARN: self-update download failed — current version unchanged" >&2
        rm -rf "$TMPD"
        exit 0
    }
    tar -xzf "${TMPD}/toolhub.tar.gz" -C "$TMPD" || {
        echo "[toolhub] ERROR: extraction failed" >&2
        rm -rf "$TMPD"
        exit 1
    }
    if [ ! -f "${TMPD}/toolhub.sh" ]; then
        echo "[toolhub] ERROR: toolhub.sh not found in package" >&2
        rm -rf "$TMPD"
        exit 1
    fi
    bash -n "${TMPD}/toolhub.sh" || {
        echo "[toolhub] ERROR: downloaded script has syntax errors" >&2
        rm -rf "$TMPD"
        exit 1
    }
    cp "${TMPD}/toolhub.sh" "$SELF_FILE"
    chmod +x "$SELF_FILE"
    rm -rf "$TMPD"
    echo "[toolhub] self-update done: ${VERSION}" >&2
    echo "[toolhub]   file : ${SELF_FILE}" >&2
    exit 0
fi

# ── 下载 & 缓存 (离线/失败兜底) ──────────────────────────────────

CACHE_DIR="${CACHE}/${TOOL_NAME}/${VERSION}"
EXTRACTED_MARKER="${CACHE_DIR}/.extracted"
TOOL_OFFLINE="${IMFL_TOOL_OFFLINE:-0}"

if [ -f "$EXTRACTED_MARKER" ]; then
    echo "[toolhub] using cached ${TOOL_NAME}@${VERSION}" >&2
elif [ "$TOOL_OFFLINE" = "1" ]; then
    _fallback=$(_find_any_cached_tool "$TOOL_NAME")
    if [ -n "$_fallback" ]; then
        local _fbv=$(basename "$_fallback")
        echo "[toolhub] WARN: offline — using cached ${TOOL_NAME}@${_fbv}" >&2
        CACHE_DIR="$_fallback"
        EXTRACTED_MARKER="${CACHE_DIR}/.extracted"
        VERSION="$_fbv"
    else
        echo "[toolhub] ERROR: offline mode — no cached ${TOOL_NAME} available" >&2
        echo "[toolhub]        run online once to populate cache, then retry" >&2
        exit 1
    fi
else
    echo "[toolhub] downloading ${TOOL_NAME}@${VERSION}..." >&2
    rm -rf "$CACHE_DIR"
    mkdir -p "$CACHE_DIR"
    TAR_URL="${HUB}/${ARTIFACT}"
    TAR_FILE="${CACHE_DIR}/$(basename "$ARTIFACT")"

    _curl "$TAR_URL" -o "$TAR_FILE" || {
        echo "[toolhub] WARN: download failed" >&2
        _fallback=$(_find_any_cached_tool "$TOOL_NAME")
        if [ -n "$_fallback" ]; then
            local _fbv=$(basename "$_fallback")
            echo "[toolhub] WARN: falling back to cached ${TOOL_NAME}@${_fbv}" >&2
            rm -rf "$CACHE_DIR"
            CACHE_DIR="$_fallback"
            EXTRACTED_MARKER="${CACHE_DIR}/.extracted"
            VERSION="$_fbv"
        else
            echo "[toolhub] ERROR: no cached version available and download failed" >&2
            exit 1
        fi
    }

    if [ -f "$EXTRACTED_MARKER" ]; then
        rm -f "$TAR_FILE"
    else
        echo "[toolhub] extracting..." >&2
        tar -xzf "$TAR_FILE" -C "$CACHE_DIR" || {
            echo "[toolhub] ERROR: extraction failed — clearing cache" >&2
            rm -rf "$CACHE_DIR"
            exit 1
        }
        rm -f "$TAR_FILE"
        touch "$EXTRACTED_MARKER"
    fi
fi

# ── 注入环境变量 ──────────────────────────────────────────────────

ENV_TMP=$(mktemp /tmp/toolhub_env_XXXXXX)
echo "$TOOL_META" | python3 -c "
import json,sys
env = json.load(sys.stdin).get('env',{})
for k, v in env.items():
    v = v.replace('\044{IMFL_PRJ_ROOT}', sys.argv[1])
    print('export {}=\"{}\"'.format(k, v))
" "$PRJ_ROOT" > "$ENV_TMP" 2>/dev/null

if [ -s "$ENV_TMP" ]; then
    # shellcheck source=/dev/null
    source "$ENV_TMP"
fi
rm -f "$ENV_TMP"

# ── 注入通用环境变量 ──────────────────────────────────────────────

export TOOLHUB_TOOL_VERSION="$VERSION"
export TOOLHUB_TOOL_NAME="$TOOL_NAME"
export TOOLHUB_TOOL_CHANNEL="$CHANNEL"

# ── 运行工具 ──────────────────────────────────────────────────────

ENTRY_PATH="${CACHE_DIR}/${ENTRY}"

if [ ! -f "$ENTRY_PATH" ]; then
    echo "[toolhub] ERROR: entry \"${ENTRY}\" not found" >&2
    echo "[toolhub]        contents: $(ls "$CACHE_DIR" 2>/dev/null)" >&2
    exit 1
fi

case "$RUNTIME" in
    shell|bash|sh)
        exec bash "$ENTRY_PATH" "$@"
        ;;
    python|python3)
        exec python3 "$ENTRY_PATH" "$@"
        ;;
    node)
        exec node "$ENTRY_PATH" "$@"
        ;;
    executable|"")
        if [ -x "$ENTRY_PATH" ]; then
            exec "$ENTRY_PATH" "$@"
        else
            exec bash "$ENTRY_PATH" "$@"
        fi
        ;;
    *)
        exec "$RUNTIME" "$ENTRY_PATH" "$@"
        ;;
esac
