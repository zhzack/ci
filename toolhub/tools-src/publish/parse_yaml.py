#!/usr/bin/env python3
"""极简 plugin.yaml 解析器（toolhub 专用子集）。

只解析发布脚本和引导脚本真正关心的字段：
- 顶层标量: name / version / description
- runtime.type / runtime.entry
- toolhub.env 嵌套映射

不依赖 PyYAML，避免给工具引入第三方依赖。
支持内联空容器 {} / [] 与 null。
"""
import os
import re


def _scalar(val):
    val = val.strip()
    if val == "{}":
        return {}
    if val == "[]":
        return []
    if val == "null":
        return None
    return val.strip('"').strip("'")


def parse_plugin_yaml(path):
    result = {}
    if not os.path.isfile(path):
        return result
    section = None
    subsection = None
    for raw in open(path, encoding="utf-8"):
        line = raw.rstrip()
        if not line.strip() or line.strip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        content = line.strip()
        if content.startswith("contract") or content.startswith("inputs") or content.startswith("outputs"):
            section = None
            subsection = None
            continue
        m = re.match(r"^([^:]+):\s*(.*)$", content)
        if not m:
            continue
        key, val = m.group(1).strip(), m.group(2).strip()
        if indent == 0:
            section = key
            subsection = None
            result.setdefault(key, {})
            if val:
                result[key] = _scalar(val)
            continue
        if indent == 2 and section in ("runtime", "toolhub"):
            if key == "env" and not val:
                subsection = "env"
                result.setdefault(section, {}).setdefault("env", {})
                continue
            result.setdefault(section, {})[key] = _scalar(val) if val else {}
            continue
        if indent >= 4 and section == "toolhub" and subsection == "env":
            result["toolhub"]["env"][key] = _scalar(val)
    return result


if __name__ == "__main__":
    import json
    import sys
    print(json.dumps(parse_plugin_yaml(sys.argv[1]), ensure_ascii=False))
