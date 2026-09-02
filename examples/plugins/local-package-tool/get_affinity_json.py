#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

CATEGORY_RULES = [
    ("适配器模块", ["Adap_"]),
    ("HMI 模块", ["HMI_", "hmi_service", "hmi_service_main", "hmi_service_mfrlaunch"]),
    ("IM 模块", ["im_"]),
    ("MFF 模块", ["mff_"]),
    ("规划模块", ["apa_planning", "cp_planning", "mrm_planning", "pnp_planning", "unp_planning"]),
    ("感知/传感器模块", ["camera_", "lidar_", "localization", "hdmap_plugin", "sensor_service", "ipd_recorder", "lpnp_online_mapping", "map_provider", "map_provider_pnp"]),
    ("服务/系统模块", ["basic_env_monitor", "calib_service", "config_service", "dynamic_safety_check", "fdi_statistics", "fdr", "fff", "mlog_daemon", "pe_monitor", "phm", "sm", "ssm", "state_service", "tmas_time_sync", "uss_service", "vehicle_service", "vehicle_service_mfrlaunch"]),
    ("融合/映射模块", ["dd_parking_fusion", "online_mapping_framework", "parking_fusion"]),
    ("控制/核心模块", ["ace_release", "control", "ct_player", "npp_cpp_switch", "tos_media_core", "vista_release"]),
]

DEFAULT_PLATFORMS = ["CSUVL3_main", "thorU", "orinX"]
DEFAULT_OUTPUT = "output/module_affinity.json"


def parse_scalar_value(value: str) -> Optional[Any]:
    if value in {"null", "None", "~", ""}:
        return None
    if value.startswith('"') and value.endswith('"'):
        return value[1:-1]
    if value.startswith("'") and value.endswith("'"):
        return value[1:-1]
    if value.isdigit() or (value.startswith("-") and value[1:].isdigit()):
        return int(value)
    return value


def parse_swcs_yaml(path: Path) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.rstrip("\n")
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if line.startswith("- name:") or line.startswith("  - name:"):
            name = stripped.split(":", 1)[1].strip()
            if current is not None:
                entries.append(current)
            current = {"name": name, "cpu_affinity": None, "priority": None}
            continue

        if current is None:
            continue

        if stripped.startswith("affinity:"):
            value = stripped.split(":", 1)[1].strip()
            current["cpu_affinity"] = parse_scalar_value(value)
            continue

        if stripped.startswith("scheduling_priority:"):
            value = stripped.split(":", 1)[1].strip()
            current["priority"] = parse_scalar_value(value)
            continue

    if current is not None:
        entries.append(current)
    return entries


def categorize_module(name: str) -> str:
    lowercase_name = name.lower()
    for category_name, prefixes in CATEGORY_RULES:
        for prefix in prefixes:
            if name.startswith(prefix) or lowercase_name.startswith(prefix):
                return category_name
    if lowercase_name.endswith("_mfrlaunch"):
        return "HMI 模块" if "hmi" in lowercase_name else "服务/系统模块"
    return "其他模块"


def build_grouped_affinity(entries: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    grouped: Dict[str, List[Dict[str, Any]]] = {category: [] for category, _ in CATEGORY_RULES}
    grouped["其他模块"] = []
    for entry in sorted(entries, key=lambda item: item["name"]):
        category = categorize_module(entry["name"])
        grouped.setdefault(category, []).append(entry)
    return {k: v for k, v in grouped.items() if v}


def extract_platform_affinity(root: Path, platform: str) -> Optional[Dict[str, Any]]:
    platform_root = root / "m" / "modules" / "mf_graph" / "meta" / platform
    if not platform_root.exists():
        return None

    swcs_dir = platform_root / "swcs"
    if not swcs_dir.exists():
        return None

    entries: List[Dict[str, Any]] = []
    for yaml_file in sorted(swcs_dir.glob("*.yml")):
        entries.extend(parse_swcs_yaml(yaml_file))

    for entry in entries:
        entry["category"] = categorize_module(entry["name"])

    return {
        "platform": platform,
        "module_affinity": {
            entry["name"]: {
                "cpu_affinity": entry["cpu_affinity"],
                "priority": entry["priority"],
                "category": entry["category"],
            }
            for entry in entries
        },
        "grouped_affinity": build_grouped_affinity(entries),
    }


def get_input_m_filenames(root: Path) -> List[str]:
    input_m_dir = root / "input" / "m"
    if not input_m_dir.exists():
        return []
    return sorted(
        item.name
        for item in input_m_dir.iterdir()
        if item.is_file() and item.name != ".gitkeep"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract Thor mf_graph module affinity and priority for selected platforms.")
    parser.add_argument("subdir", nargs="?", default=None,
                        help="Optional subdirectory under current working dir, e.g. ttx to use ./ttx")
    parser.add_argument("--root", default=".", help="Thor project root path for output and default lookup")
    parser.add_argument("--package", default=None,
                        help="Package root directory under which m/modules/mf_graph can be found")
    parser.add_argument("--platforms", default=','.join(DEFAULT_PLATFORMS),
                        help="Comma-separated platform names under m/modules/mf_graph/meta")
    parser.add_argument("--output", default=DEFAULT_OUTPUT,
                        help="Output JSON file path for combined results")
    parser.add_argument("--split", action="store_true",
                        help="Write one JSON file per platform instead of a combined file")
    parser.add_argument("--raw", action="store_true",
                        help="Output raw module name mapping only, without category grouping")
    args = parser.parse_args()

    root = Path(args.subdir).resolve() if args.subdir else Path(args.root).resolve()
    package_root = Path(args.package).resolve() if args.package else root
    platforms = [name.strip() for name in args.platforms.split(",") if name.strip()]
    if not platforms:
        raise ValueError("At least one platform must be specified")

    m_package_files = get_input_m_filenames(root)

    results: Dict[str, Any] = {}
    for platform in platforms:
        plat_res = extract_platform_affinity(package_root, platform)
        if plat_res is not None:
            results[platform] = plat_res

    # If default platforms had no match, try searching any meta directory under package_root
    if not results:
        meta_dir = package_root / "m" / "modules" / "mf_graph" / "meta"
        if meta_dir.is_dir():
            for p_dir in sorted(meta_dir.iterdir()):
                if p_dir.is_dir():
                    plat_res = extract_platform_affinity(package_root, p_dir.name)
                    if plat_res is not None:
                        results[p_dir.name] = plat_res

    if not results:
        print(f"No platform metadata found in {package_root / 'm' / 'modules' / 'mf_graph' / 'meta'}")
        return

    out_p = Path(args.output)
    output_path = out_p.resolve() if out_p.is_absolute() else (root / out_p).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if args.split:
        for platform, platform_result in results.items():
            split_out = output_path.parent / f"module_affinity.{platform}.json"
            output_data = platform_result["module_affinity"] if args.raw else platform_result
            if m_package_files:
                output_data = {"m_package_files": m_package_files, **output_data}
            split_out.write_text(json.dumps(output_data, ensure_ascii=False, indent=4) + "\n", encoding="utf-8")
            print(f"Generated {split_out}")
    else:
        output_data = {
            platform: platform_result["module_affinity"] if args.raw else platform_result
            for platform, platform_result in results.items()
        }
        if m_package_files:
            output_data = {"m_package_files": m_package_files, **output_data}
        output_path.write_text(json.dumps(output_data, ensure_ascii=False, indent=4) + "\n", encoding="utf-8")
        print(f"Generated {output_path}")


if __name__ == '__main__':
    main()