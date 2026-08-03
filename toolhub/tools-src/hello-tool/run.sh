#!/bin/bash
# hello-tool — 多脚本兼容性示例工具
# 演示 toolhub 如何支持 python / bash / 任意 runtime 的工具

set -euo pipefail

echo "=== hello-tool ${TOOLHUB_TOOL_VERSION:-unknown} ==="
echo "runtime:     bash"
echo "prj_root:    ${IMFL_PRJ_ROOT:-not set}"
echo "args:        $*"
echo "files:       $(ls)"
echo "========================================"
