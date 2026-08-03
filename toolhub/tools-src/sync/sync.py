#!/usr/bin/env python3
"""sync.py — 在同事之间同步任意文件夹(基于 Artifactory)。

用途:
  把本地任意文件夹打成 tar.gz,推送到 Artifactory 的某个 repo,
  让同事(或者你自己换机器时)拉下来解压回原位。
  不是构建工具 —— 给 imfl_auto_test 用的 get_imthirdparty.py 才是构建用的。

manifest 文件(sync.json)结构:

    {
      "imfl_deps": {
        "type":         "folder",                            // 可选,默认 "lib"
        "version":      "v1.0.0",
        "archive_name": "imfl_deps",
        "pack_dir":     "./imfl_cases/imfl/tmas/test/deps",
        "extract_dirs": [
          "./imfl_cases/imfl/tmas/test/deps",
          "./imfl_cases/imfl/djs/test/deps"
        ]
      }
    }

字段含义:
  type          可选。"lib"(默认) -> .../IMThirdParty/;"folder" -> .../TEST/MFF
  version       必填。版本号,出现在文件名里 v1.0.0 -> imfl_deps-v1.0.0.tar.gz
  archive_name  必填。tar 文件名前缀;整本 manifest 里必须唯一
  pack_dir      必填。upload 时打包的源目录(单数)
  extract_dirs  必填。download 时解压结果要复制到的目标目录列表(复数)

相对路径:
  manifest 里 pack_dir / extract_dirs 凡是以 "./" 或 "../" 开头的相对路径,
  都解析为相对 PROJECT_ROOT 的绝对路径(详见下面 PROJECT_ROOT 的注释)。

远端 URL 计算:
  <type 决定的 base>/<archive_name>/<version>/<archive_name>-<version>.tar.gz

子命令:
  upload    把 pack_dir 打成 tar.gz,HEAD 检查远端(已存在则报错),然后 PUT
  download  HEAD 检查远端,GET 拉 tar,解压,把单根 cp -r 到所有 extract_dirs
  list      列出每条 entry 解析后的远端 URL(不发任何 HTTP 请求)
  (省略)    等价于 download

凭证:
  默认用脚本顶部 DEFAULT_ARTIFACTORY_USER / DEFAULT_ARTIFACTORY_PASS 硬编码值。
  环境变量 ARTIFACTORY_USER / ARTIFACTORY_PASS 始终优先。

依赖:
  Python 3.6+,以及系统命令 curl、tar、gzip。
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from collections import OrderedDict
from urllib.parse import urlparse
import datetime

DEFAULT_CONFIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sync.json")

# 路径基准:相对当前 sync.py 脚本所在的目录。
# manifest 里的 pack_dir / extract_dirs 凡是以 "./" 或 "../" 开头的相对路径,
# 都解析为相对 PROJECT_ROOT 的绝对路径。
# 例如:
#   PROJECT_ROOT = /data/code/X86/app/sync  (脚本在 app/sync/sync.py)
#   pack_dir = "./calib"                     -> /data/code/X86/app/sync/calib
#   pack_dir = "../calib"                    -> /data/code/X86/app/calib  (上跳一级)
#   pack_dir = "/data/code/X86/app/calib"    -> 原样使用 (绝对路径)
#
# 如果你想换基准目录,在环境变量里设置 SYNC_PROJECT_ROOT 即可。
PROJECT_ROOT = os.environ.get("SYNC_PROJECT_ROOT") or os.environ.get("IMFL_PRJ_ROOT") or os.path.dirname(os.path.abspath(__file__))
VERSION_FILE = ".sync_version.json"

# 下载缓存开关。设为 True 时,download 会把 tar 包留在本地缓存目录里,
# 下次同样的 entry 优先用缓存(经 gzip -t 校验),跳过 HTTP 请求。
# 设成 False 则每次都访问 Artifactory。
# upload 永远不碰缓存,只往 Artifactory PUT。
USE_DOWNLOAD_CACHE = True

# 缓存根目录。默认 <PROJECT_ROOT>/.sync_cache,即脚本同级的隐藏目录。
# 想换位置可以设环境变量 SYNC_CACHE_ROOT。
DEFAULT_CACHE_ROOT = os.environ.get("SYNC_CACHE_ROOT") or os.path.join(PROJECT_ROOT, ".sync_cache")

# 凭证默认值。同步账号是只读下载用的,通常安全(同 get_imthirdparty.py)。
# 想用自己的账号,从环境变量传 ARTIFACTORY_USER / ARTIFACTORY_PASS 即可。
DEFAULT_ARTIFACTORY_USER = "user_download"
DEFAULT_ARTIFACTORY_PASS = "Hsx2022@"

# type 字段 -> 远端 base URL 的映射。
# 同步哪个 repo(以及它的访问路径前缀)由这里决定。
# 想加新的 repo,在这里加一行即可;manifest 里 type 字段写对应的 key。
TYPE_BASE_URLS = OrderedDict([
    ("lib",    "https://ciartifactory-prd.ap.immotors.com/artifactory/IMThirdParty/"),
    ("folder", "https://ciartifactory-prd.ap.immotors.com/artifactory/TEST/MFF"),
])

# .gitignore 顶部要追加的通用忽略项(写到 git 仓库根目录 .gitignore 的最顶端)。
# 覆盖 Python 缓存、编辑器残留、IDE 配置、sync.py 自己的缓存目录等。
# 第一次 upload 时若 .gitignore 不存在,这个 prefix 会成为文件的初始内容;
# 若已存在,会插在已有内容前面(去重)。想换内容直接改这里。
#
# 注意:.sync_cache/ 用 **/ 前缀,这样能从仓库根匹配任意层级的 .sync_cache 目录
# (默认位置是 app/sync/.sync_cache,但脚本可能在仓库里任何地方被运行)。
DEFAULT_GITIGNORE_PREFIX = [
    "# === managed by sync.py (do not edit below this line) ===",
    "__pycache__/",
    "*.pyc",
    "*.pyo",
    ".DS_Store",
    "Thumbs.db",
    "*.swp",
    "*.swo",
    "*~",
    ".idea/",
    ".vscode/",
    "*.log",
    "**/.sync_cache/",
    "**/.sync_version.json",
    "",
]


# ---------- helpers ----------------------------------------------------------

def _load_config(path):
    """加载 manifest JSON。返回 (cfg, manifest_dir) 让调用方知道 manifest 在哪。
    注意:路径基准仍然是 PROJECT_ROOT(脚本所在目录),不是 manifest 目录。

    加载时立刻做一次 archive_name fallback:省略的 entry 用 JSON 顶层 key 顶上。
    这样 list / _resolve_url / 缓存路径等所有下游代码都不需要各自再做 fallback。"""
    if not os.path.exists(path):
        sys.stderr.write("ERROR: config file not found: {}\n".format(path))
        sys.exit(2)
    with open(path, "r") as f:
        cfg = json.load(f, object_pairs_hook=OrderedDict)
    for name, entry in cfg.items():
        entry.setdefault("archive_name", name)
    return cfg, os.path.dirname(os.path.abspath(path))


def _cred_args():
    """构造给 curl 的 ["-u", "user:pass"] 列表。
    优先级:环境变量 ARTIFACTORY_USER / ARTIFACTORY_PASS > 脚本顶部硬编码默认值。"""
    user = os.environ.get("ARTIFACTORY_USER") or DEFAULT_ARTIFACTORY_USER
    pwd = os.environ.get("ARTIFACTORY_PASS") or DEFAULT_ARTIFACTORY_PASS
    return ["-u", "{}:{}".format(user, pwd)]


def _resolve_url(entry):
    """根据 entry 的 type 字段挑 base URL,再拼上 archive_name / version / 文件名。
    返回的 URL 长这样: <base>/<archive_name>/<version>/<archive_name>-<version>.tar.gz"""
    type_key = entry.get("type", "lib")
    if type_key not in TYPE_BASE_URLS:
        sys.stderr.write(
            "ERROR: entry {!r}: unknown type {!r}; expected one of {}\n".format(
                entry.get("archive_name", "?"), type_key, list(TYPE_BASE_URLS)))
        sys.exit(2)
    base = TYPE_BASE_URLS[type_key]
    archive = "{}-{}.tar.gz".format(entry["archive_name"], entry["version"])
    return base.rstrip("/") + "/" + entry["archive_name"] + "/" + entry["version"] + "/" + archive


def _run(cmd, **kw):
    """subprocess 的薄包装:打印命令、出错时 sys.exit 非零。
    用来跑 tar / gzip 这种非 HTTP 命令。"""
    sys.stdout.write("$ {}\n".format(" ".join(cmd)))
    rc = subprocess.call(cmd, **kw)
    if rc != 0:
        sys.stderr.write("ERROR: command failed (rc={}): {}\n".format(rc, cmd))
        sys.exit(rc)


def _curl(method, url, extra=None, long_running=False):
    """跑一条 curl,返回 (returncode, stdout, stderr)。

    完全不设 --max-time —— 大文件 / 慢连接时不被超时砍掉。
    只保留 --connect-timeout 10,防"完全连不上"卡死。

    long_running 参数现在没用(签名里保留是为了不破坏调用方),
    想加额外 curl 参数(续传 -C -、重试 --retry 等),传 extra=[...]。"""
    cmd = ["curl", "-sS", "--connect-timeout", "10",
           "-X", method] + _cred_args() + [url]
    if extra:
        cmd += extra
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return p.returncode, p.stdout, p.stderr


def _head_exists(url):
    """HEAD 请求检查远端是否存在这个文件。返回 True 当且仅当:
      1. curl 进程退出码 0
      2. stderr 里没有 "timed out"(防止半截响应冒充成功)
      3. 响应头第一行包含 " 200 "

    不设 --max-time —— 连接阶段慢的时候也不该被砍掉。"""
    cmd = ["curl", "-sS", "-I", "--connect-timeout", "10"] \
          + _cred_args() + [url]
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if p.returncode != 0:
        return False
    if "timed out" in (p.stderr or "").lower():
        return False
    first_status = (p.stdout or "").splitlines()[0:1]
    return bool(first_status) and " 200 " in first_status[0]


def _resolve_path(p):
    """把 manifest 里写的路径解析成绝对路径:
      - 已经是绝对路径 -> 原样返回
      - 以 "./" 或 "../" 开头 -> 相对 PROJECT_ROOT 解析
      - 其它(裸的 "foo/bar") -> 原样返回,留给校验阶段报错"""
    if not isinstance(p, str) or os.path.isabs(p):
        return p
    if p.startswith("./") or p.startswith("../"):
        return os.path.normpath(os.path.join(PROJECT_ROOT, p))
    return p  # bare relative path like "foo/bar"; leave for validator


def _validate_entry(name, entry, require_pack_dir=True):
    """校验单条 entry 的合法性。任何结构性问题都 sys.exit(2)。

    顺便把路径解析成绝对路径(in-place 写回 entry):
      pack_dir -> entry["pack_dir"]
      extract_dirs[i] -> entry["extract_dirs"][i]

    require_pack_dir=False 是 download 用的:download 不需要 pack_dir 在本地存在,
    因为它根本不用 pack_dir。只在 upload 时才要求 pack_dir 是真存在的目录。"""
    for field in ("version", "pack_dir", "archive_name", "extract_dirs"):
        if field not in entry:
            sys.stderr.write(
                "ERROR: entry {!r} is missing required field {!r}\n".format(name, field))
            sys.exit(2)
    if "type" in entry and entry["type"] not in TYPE_BASE_URLS:
        sys.stderr.write(
            "ERROR: entry {!r}: type {!r} not in known types {}\n".format(
                name, entry["type"], list(TYPE_BASE_URLS)))
        sys.exit(2)
    if not isinstance(entry["extract_dirs"], list) or not entry["extract_dirs"]:
        sys.stderr.write(
            "ERROR: entry {!r}: extract_dirs must be a non-empty list\n".format(name))
        sys.exit(2)

    # archive_name 的 fallback 在 _load_config 里已经做过,这里不用再 setdefault。
    entry["pack_dir"] = _resolve_path(entry["pack_dir"])
    if require_pack_dir:
        if entry["pack_dir"] is None or not os.path.isdir(entry["pack_dir"]):
            sys.stderr.write(
                "ERROR: entry {!r}: pack_dir does not exist or is not a directory: {}\n".format(
                    name, entry["pack_dir"]))
            sys.exit(2)

    for i, d in enumerate(entry["extract_dirs"]):
        entry["extract_dirs"][i] = _resolve_path(d)
        if entry["extract_dirs"][i] is None:
            sys.stderr.write(
                "ERROR: entry {!r}: extract_dirs entry must be a string: {!r}\n".format(name, d))
            sys.exit(2)
        if os.path.exists(entry["extract_dirs"][i]) and not os.path.isdir(entry["extract_dirs"][i]):
            sys.stderr.write(
                "ERROR: entry {!r}: extract_dirs entry exists but is not a directory: {}\n".format(
                    name, entry["extract_dirs"][i]))
            sys.exit(2)


def _validate_unique_archive_names(cfg):
    """检查整本 manifest 里所有 archive_name 互不重复。
    重复会让缓存路径和远端 URL 冲突,所以必须在启动期拦截。
    缺省的 archive_name 用顶层 key 顶上(同 _validate_entry 的 setdefault 语义)。"""
    seen = {}
    for name, entry in cfg.items():
        an = entry.get("archive_name", name)
        if an in seen:
            sys.stderr.write(
                "ERROR: archive_name {!r} is used by both {!r} and {!r}; must be unique.\n".format(
                    an, seen[an], name))
            sys.exit(2)
        seen[an] = name


def _select_entries(cfg, key):
    """根据 --key 过滤要处理的 entry。key=None 表示全部。"""
    if key is None:
        return list(cfg.items())
    if key not in cfg:
        sys.stderr.write("ERROR: --key {!r} not found in config (have: {})\n".format(
            key, sorted(cfg.keys())))
        sys.exit(2)
    return [(key, cfg[key])]


# ---------- pack / unpack ----------------------------------------------------

def _make_tarball(pack_dir, archive_name, version, out_path):
    """把 pack_dir 整个目录打包成 tar.gz 到 out_path。
    内部 tar 命令形如: tar -czf out.tar.gz -C /parent pack_dir_basename
    这样 tar 包里的根目录名就是 pack_dir 的 basename,不是完整路径。"""
    parent = os.path.dirname(os.path.abspath(pack_dir))
    base = os.path.basename(os.path.abspath(pack_dir))
    _run(["tar", "-czf", out_path, "--exclude=.sync_version.json", "-C", parent, base])


def _extract_tarball(tar_path, dest_dir):
    """解压 tar.gz 到 dest_dir(必须是空目录)。"""
    _run(["tar", "-xzf", tar_path, "-C", dest_dir])


def _detect_single_root(extract_dir):
    """解压到临时目录后,找到里面的唯一顶层目录(就是 _make_tarball 时的 basename)。
    不是 1 个就报错退出 —— 我们约定打包后 tar 内部必须正好 1 个根。"""
    entries = os.listdir(extract_dir)
    if len(entries) != 1:
        sys.stderr.write(
            "ERROR: expected exactly 1 top-level entry after extraction, got {}: {}\n".format(
                len(entries), entries))
        sys.exit(1)
    return os.path.join(extract_dir, entries[0])


def _replace_with_copy(src_dir, dest_dir):
    """把 src_dir 的内容复制到 dest_dir(覆盖式)。

    行为:
      1. dest_dir 已存在 -> rm -rf 整个删掉
      2. dest_dir 的父目录不存在 -> 自动创建(mkdir -p)
      3. shutil.copytree(src_dir, dest_dir) 把解压出来的单根 cp -r 进去

    注意:dest_dir 必须是目录路径(不能是已存在的文件);校验阶段已经拦过了。"""
    if os.path.exists(dest_dir):
        sys.stdout.write("Removing existing: {}\n".format(dest_dir))
        shutil.rmtree(dest_dir)
    parent = os.path.dirname(os.path.abspath(dest_dir))
    if parent and not os.path.exists(parent):
        sys.stdout.write("Creating parent: {}\n".format(parent))
        os.makedirs(parent, exist_ok=True)
    sys.stdout.write("Copying to: {}\n".format(dest_dir))
    shutil.copytree(src_dir, dest_dir)


def _cache_path_for(entry):
    """返回这条 entry 的缓存路径(平铺结构):
    <DEFAULT_CACHE_ROOT>/<archive_name>-<version>.tar.gz"""
    archive = "{}-{}.tar.gz".format(entry["archive_name"], entry["version"])
    return os.path.join(DEFAULT_CACHE_ROOT, archive)


def _cache_is_valid(tar_path):
    """检查缓存是否还能用。三条都满足才算 valid:
      1. 文件存在
      2. 大小 > 0(不是上次下载失败的 0 字节残骸)
      3. gzip -t 校验通过(只是 gzip 完整性,不校验 tar 内容)"""
    if not os.path.exists(tar_path) or os.path.getsize(tar_path) == 0:
        return False
    rc = subprocess.call(["gzip", "-t", tar_path],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return rc == 0


def _read_version_file(dir_path):
    """读取目录下的 .sync_version.json,返回 dict 或 None。"""
    vf = os.path.join(dir_path, VERSION_FILE)
    if not os.path.isfile(vf):
        return None
    try:
        with open(vf, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return None


def _write_version_file(dir_path, archive_name, version, url=""):
    """在指定目录写入 .sync_version.json,记录同步版本信息。"""
    vf = os.path.join(dir_path, VERSION_FILE)
    data = OrderedDict([
        ("archive_name", archive_name),
        ("version", version),
        ("synced_at", datetime.datetime.now().isoformat()),
    ])
    if url:
        data["url"] = url
    if not os.path.exists(dir_path):
        os.makedirs(dir_path, exist_ok=True)
    with open(vf, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    sys.stdout.write("  version file: {}\n".format(vf))
    return vf


def _find_git_root():
    """从脚本所在目录向上找 .git 目录,返回 git 仓库根目录绝对路径。
    如果找不到(不在 git 仓库里),就 fallback 到 manifest 所在目录。"""
    start = os.path.dirname(os.path.abspath(__file__))
    cur = start
    while True:
        if os.path.isdir(os.path.join(cur, ".git")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:  # 已经到文件系统根
            return None
        cur = parent


def _append_to_gitignore(config_path, abs_paths):
    """upload 成功后:
      1. 确保 DEFAULT_GITIGNORE_PREFIX 出现在 git 仓库根目录 .gitignore 的顶部
         (去重插入,已有的不重复)
      2. 把 abs_paths 列表里的所有路径(转成相对 git 仓库根)追加到末尾
         (同样去重)

    行为细节:
      - 不存在 .gitignore -> 新建,内容 = DEFAULT_GITIGNORE_PREFIX + abs_paths
      - 已存在 -> 把 prefix 里缺的项插到顶部,然后把 abs_paths 追加到末尾
      - 路径是相对 git 仓库根的(因为 gitignore 不支持 ../,任何 manifest 之外的
        路径都必须从仓库根算起;否则 git 会把 ../... 当字面匹配,无效)。
      - 找不到 git 仓库时 fallback 到 manifest 目录,只在所有路径都能写成
        相对 manifest 目录(不含 ..)时才能正常生效。
    """
    config_dir = os.path.dirname(os.path.abspath(config_path))
    git_root = _find_git_root()
    if git_root is None:
        sys.stderr.write(
            "WARNING: not inside a git repository; falling back to manifest-dir .gitignore.\n"
            "  Paths outside manifest dir may not be ignored correctly.\n")
        base_dir = config_dir
    else:
        base_dir = git_root

    gi_path = os.path.join(base_dir, ".gitignore")
    existing = []
    if os.path.exists(gi_path):
        with open(gi_path, "r") as f:
            existing = [line.rstrip("\n") for line in f.readlines()]

    # ---- 步骤 1:确保 prefix 在文件里 ----
    prefix_missing = [line for line in DEFAULT_GITIGNORE_PREFIX if line and line not in existing]
    prefix_added = []
    if prefix_missing:
        # 找到第一条非 prefix 行(用户原有内容),插在它前面
        # 简化:直接把 prefix 整块插到文件最顶端,后面留一行空行分隔
        body = existing
        new_lines = list(DEFAULT_GITIGNORE_PREFIX) + ([""] if body and body[0] else []) + body
        with open(gi_path, "w") as f:
            f.write("\n".join(new_lines) + "\n")
        # 更新 existing,后续去重用
        existing = [line.rstrip("\n") for line in ("\n".join(new_lines)).split("\n")]
        prefix_added = [l for l in DEFAULT_GITIGNORE_PREFIX if l]
        for p in prefix_added:
            sys.stdout.write("  gitignore +  : {}\n".format(p))

    # ---- 步骤 2:追加 abs_paths ----
    rels = []
    for abs_path in abs_paths:
        rel = os.path.relpath(abs_path, base_dir)
        # 防御:如果走了 fallback 又出现 .. 路径,gitignore 也不会生效,直接警告
        if rel.startswith(".."):
            sys.stderr.write(
                "WARNING: path {!r} resolves to {!r} which is outside the .gitignore's\n"
                "  base directory {!r}; git cannot ignore paths with '..' in .gitignore.\n"
                "  Move the path or add it to a parent .gitignore manually.\n".format(
                    abs_path, rel, base_dir))
            continue
        # 去重:精确匹配 / 或带斜杠 / 不带斜杠都算已存在
        if rel in existing or (rel + "/") in existing or rel.rstrip("/") in existing:
            continue
        rels.append(rel)
        existing.append(rel)

    if rels:
        for r in rels:
            sys.stdout.write("  gitignore +  : {}\n".format(r))
        with open(gi_path, "a") as f:
            if existing and existing[-1] != "":
                f.write("\n")
            f.write("# Added by sync.py — managed by upload\n")
            for r in rels:
                f.write(r + "\n")

    return prefix_added, rels


def _extract_and_apply(tar_path, extract_dirs, entry=None):
    """把 tar_path 解压到新临时目录,把解压出来的单根复制到 extract_dirs 每个目标。
    临时目录在函数返回时自动清理,所以处理大文件时这里不存留中间产物。
    若传入 entry(包含 archive_name、version),则在每个 extract_dir 写入
    .sync_version.json 记录版本信息。"""
    with tempfile.TemporaryDirectory(prefix="sync_download_") as tmp:
        extract_tmp = os.path.join(tmp, "extracted")
        os.makedirs(extract_tmp)
        _extract_tarball(tar_path, extract_tmp)
        root = _detect_single_root(extract_tmp)
        for dest in extract_dirs:
            _replace_with_copy(root, dest)
            if entry:
                _write_version_file(dest, entry["archive_name"], entry["version"])


# ---------- subcommands ------------------------------------------------------

def cmd_upload(args):
    """上传子命令。把每条 entry 的 pack_dir 打成 tar.gz,HEAD 检查远端(防止覆盖),
    然后 PUT。成功后把 pack_dir 加到 .gitignore。"""
    cfg, manifest_dir = _load_config(args.config)
    _validate_unique_archive_names(cfg)
    for name, entry in _select_entries(cfg, args.key):
        _validate_entry(name, entry)
        url = _resolve_url(entry)

        sys.stdout.write("\n=== upload {} ===\n".format(name))
        sys.stdout.write("  pack_dir : {}\n".format(entry["pack_dir"]))
        sys.stdout.write("  url      : {}\n".format(url))

        if _head_exists(url):
            sys.stderr.write(
                "ERROR: remote already has {} — refusing to overwrite. "
                "Bump 'version' in the config and retry.\n".format(url))
            sys.exit(1)

        with tempfile.TemporaryDirectory(prefix="sync_upload_") as tmp:
            archive = "{}-{}.tar.gz".format(entry["archive_name"], entry["version"])
            tar_path = os.path.join(tmp, archive)
            _make_tarball(entry["pack_dir"], entry["archive_name"], entry["version"], tar_path)
            # PUT 也用 long_running=True(没有 --max-time),原因是 Artifactory 握手
            # 在某些路径下需要 15+ 秒,默认 20s 兜底刚好赶不上。--retry 兜底:
            # 网络抖动时重试 3 次,每次间隔 5s,connection refused 也算可重试。
            rc, body, err = _curl("PUT", url,
                                  extra=["-T", tar_path,
                                         "--retry", "3",
                                         "--retry-delay", "5",
                                         "--retry-connrefused",
                                         "-f"],
                                  long_running=True)
            if rc != 0:
                sys.stderr.write("ERROR: PUT failed (curl rc={}): {}\n".format(rc, err))
                sys.exit(rc)
            # Artifactory 返回的 JSON envelope 含 "created" 字段才算真成功。
            # 否则(HTML 错误页、空 body、"errors" 数组)都是静默失败。
            if not body or '"created"' not in body:
                sys.stderr.write(
                    "ERROR: PUT response did not confirm upload.\n"
                    "  url: {}\n  body: {}\n".format(url, body[:500]))
                sys.exit(1)
            # upload 成功后,把这条 entry 涉及的所有路径加到 .gitignore:
            # pack_dir(打包源)和所有 extract_dirs(下载目标)都交给 sync.py 管,
            # 不应该被手编进 git。
            if args.manage_gitignore:
                _append_to_gitignore(args.config, [entry["pack_dir"]] + list(entry["extract_dirs"]))
            _write_version_file(entry["pack_dir"], entry["archive_name"], entry["version"], url)
        sys.stdout.write("  uploaded OK\n")


def cmd_download(args):
    """下载子命令。每条 entry:
      1. 检查 extract_dirs 版本 — 若 --force 未设且本地方向已为目标版本则跳过
      2. HEAD 检查远端是否存在 -> 不存在直接报错退出
      3. 缓存命中 -> 用本地 tar,跳过网络
      4. 缓存未命中 -> GET 下载(带续传、重试、fail-on-4xx),写到临时目录,顺便
         复制一份到缓存
      5. 解压临时 tar,找到单根,cp -r 到 extract_dirs 每个目标并写入版本文件
    """
    cfg, _manifest_dir = _load_config(args.config)
    _validate_unique_archive_names(cfg)
    for name, entry in _select_entries(cfg, args.key):
        _validate_entry(name, entry, require_pack_dir=False)
        url = _resolve_url(entry)

        sys.stdout.write("\n=== download {} ===\n".format(name))
        sys.stdout.write("  url          : {}\n".format(url))
        sys.stdout.write("  extract_dirs : {}\n".format(entry["extract_dirs"]))

        # --- 版本检查:如果所有 extract_dir 都已是最新版本则跳过 ---
        if not args.force:
            all_up_to_date = True
            for d in entry["extract_dirs"]:
                vf = _read_version_file(d)
                if vf is None:
                    all_up_to_date = False
                    sys.stdout.write("  [NEED] {} (no version file)\n".format(d))
                elif vf.get("version") != entry["version"]:
                    all_up_to_date = False
                    sys.stdout.write("  [NEED] {} (local={} remote={})\n".format(
                        d, vf.get("version"), entry["version"]))
                else:
                    sys.stdout.write("  [SKIP] {} already {}\n".format(d, entry["version"]))
            if all_up_to_date:
                sys.stdout.write("  all extract_dirs up-to-date, skipping\n")
                continue
        else:
            sys.stdout.write("  --force: skipping version check\n")

        if not _head_exists(url):
            sys.stderr.write("ERROR: remote does not have {}\n".format(url))
            sys.exit(1)

        archive = "{}-{}.tar.gz".format(entry["archive_name"], entry["version"])
        cache_path = _cache_path_for(entry)

        # 决定从哪读 tar:缓存命中直接用;否则下载,顺便把新 tar 复制到缓存。
        if USE_DOWNLOAD_CACHE and _cache_is_valid(cache_path):
            sys.stdout.write("  using cache  : {}\n".format(cache_path))
            tar_path = cache_path
        else:
            with tempfile.TemporaryDirectory(prefix="sync_download_") as tmp:
                tar_path = os.path.join(tmp, archive)
                rc, _, err = _curl(
                    "GET", url,
                    extra=[
                        "-C", "-",
                        "-f",
                        "--retry", "3",
                        "--retry-delay", "5",
                        "--retry-connrefused",
                        "-o", tar_path,
                    ],
                    long_running=True,
                )
                if rc != 0:
                    sys.stderr.write(
                        "ERROR: GET failed (curl rc={}, partial={} bytes): {}\n".format(
                            rc,
                            os.path.getsize(tar_path) if os.path.exists(tar_path) else 0,
                            err.strip().splitlines()[-1] if err else ""))
                    sys.exit(rc)
                if not os.path.exists(tar_path) or os.path.getsize(tar_path) == 0:
                    sys.stderr.write(
                        "ERROR: GET returned no bytes — remote may be unreachable. url={}\n".format(url))
                    sys.exit(1)
                if USE_DOWNLOAD_CACHE:
                    os.makedirs(DEFAULT_CACHE_ROOT, exist_ok=True)
                    shutil.copy2(tar_path, cache_path)
                    sys.stdout.write("  cached as   : {}\n".format(cache_path))
                _extract_and_apply(tar_path, entry["extract_dirs"], entry)

        if tar_path == cache_path:
            _extract_and_apply(tar_path, entry["extract_dirs"], entry)

        sys.stdout.write("  downloaded OK\n")


def cmd_list(args):
    """列子命令。打印每条 entry 解析后的远端 URL 和 pack_dir/extract_dirs。
    不发任何 HTTP 请求,纯粹用来核对 manifest 写得对不对。"""
    cfg, _manifest_dir = _load_config(args.config)
    _validate_unique_archive_names(cfg)
    for name, entry in cfg.items():
        url = _resolve_url(entry)
        sys.stdout.write(
            "[{}] type={} archive={} version={} pack_dir={} extract_dirs={}\n  -> {}\n".format(
                name,
                entry.get("type", "lib"),
                entry["archive_name"], entry["version"],
                entry["pack_dir"], entry["extract_dirs"], url))


# ---------- CLI --------------------------------------------------------------

def build_parser():
    """构造命令行解析器。三个子命令共享 --config/-c。"""
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--config", "-c", default=DEFAULT_CONFIG,
                        help="manifest JSON 路径(默认 sync.json,相对脚本所在目录)。")

    # 子命令用的 --config:不带 default,避免覆盖上层已解析的值
    sub_common = argparse.ArgumentParser(add_help=False)
    sub_common.add_argument("--config", "-c", default=argparse.SUPPRESS,
                            help=argparse.SUPPRESS)

    p = argparse.ArgumentParser(
        parents=[common],
        description="通过 HTTP(Artifactory)在同事之间同步任意文件夹。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
环境变量:
  ARTIFACTORY_USER    HTTP basic auth 用户名(覆盖脚本顶部默认值)
  ARTIFACTORY_PASS    HTTP basic auth 密码(覆盖脚本顶部默认值)
  SYNC_PROJECT_ROOT   覆盖路径基准(默认 = sync.py 所在目录)
  SYNC_CACHE_ROOT     覆盖缓存目录(默认 <PROJECT_ROOT>/.sync_cache)

默认值:
  --config 默认 sync.json(相对脚本所在目录)。
  不带子命令 -> 默认走 download。

示例:
  sync.py upload --config sync.example.json
  sync.py download -c sync.example.json --key my_config
  sync.py list
""")
    sub = p.add_subparsers(dest="action", required=True)

    pu = sub.add_parser("upload", parents=[sub_common],
                        help="打包 pack_dir 并上传;远端已有同名版本则报错。")
    pu.add_argument("--key", "-k", default=None,
                    help="只处理顶层 key 等于此值的 entry(默认: 全部)。")
    pu.add_argument("--manage-gitignore", action="store_true", default=False,
                    help="upload 后自动维护 .gitignore(默认关闭)。")
    pu.set_defaults(func=cmd_upload)

    pd = sub.add_parser("download", parents=[sub_common],
                        help="下载、解压、把单根目录复制到所有 extract_dirs 目标。")
    pd.add_argument("--key", "-k", default=None,
                    help="只处理顶层 key 等于此值的 entry(默认: 全部)。")
    pd.add_argument("--force", "-f", action="store_true", default=False,
                    help="强制下载,跳过版本检查(.sync_version.json)。")
    pd.set_defaults(func=cmd_download)

    pl = sub.add_parser("list", parents=[sub_common],
                        help="列出每条 entry 解析后的远端 URL(不发请求)。")
    pl.set_defaults(func=cmd_list)

    return p


def main(argv=None):
    """入口。默认子命令是 download,所以 `python3 sync.py` 不用带参数也能跑。"""
    if argv is None:
        argv = sys.argv[1:]
    _SUBCOMMANDS = {"upload", "download", "list"}
    has_sub = bool(set(argv) & _SUBCOMMANDS)
    if not argv:
        argv = ["download"]
    elif has_sub:
        # argv 中已有明确子命令（如 --config x list）→ 不补
        pass
    elif argv[0] in ("-h", "--help"):
        pass
    elif argv[0] not in _SUBCOMMANDS:
        argv = ["download"] + argv
    args = build_parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()