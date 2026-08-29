#!/usr/bin/env python3
"""Cross-platform script to build and package non-source release distribution."""

import argparse
import shutil
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION = "0.3.0"


def run(cmd: list[str], cwd: Path | None = None) -> None:
    print(f"\n[EXEC] {' '.join(cmd)}")
    subprocess.run(cmd, cwd=cwd or ROOT, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Package Mini Pipeline for non-source distribution"
    )
    parser.add_argument("--version", default=VERSION, help="Release version (default: 0.3.0)")
    parser.add_argument(
        "--include-images",
        action="store_true",
        help="Export offline Docker images into tar.gz bundle",
    )
    args = parser.parse_args()

    version = args.version
    dist_dir = ROOT / "dist_release"
    bundle_dir = dist_dir / f"mini-pipeline-{version}"

    if dist_dir.exists():
        shutil.rmtree(dist_dir)
    bundle_dir.mkdir(parents=True, exist_ok=True)

    print(f"=== [1/4] 构建 Docker 镜像版本: {version} ===")
    run(["docker", "build", "-t", f"ci-api:{version}", "-t", "ci-api:latest", "."])
    run(
        [
            "docker",
            "build",
            "-t",
            f"ci-frontend:{version}",
            "-t",
            "ci-frontend:latest",
            "./frontend",
        ]
    )

    print("\n=== [2/4] 复制部署编排文件与安装脚本 ===")
    deploy_src = ROOT / "deploy"
    for item in deploy_src.iterdir():
        if item.is_file():
            shutil.copy2(item, bundle_dir / item.name)

    if args.include_images:
        print(f"\n=== [3/4] 导出离线镜像归档包 (版本: {version}) ===")
        images_tar = bundle_dir / f"mini-pipeline-images-{version}.tar"
        run(
            [
                "docker",
                "save",
                "-o",
                str(images_tar),
                f"ci-api:{version}",
                f"ci-frontend:{version}",
                "postgres:16-alpine",
            ]
        )
        print(f"压缩离线镜像包至 gzip: {images_tar}.gz")
        with tarfile.open(f"{images_tar}.gz", "w:gz") as f_out:
            f_out.add(images_tar, arcname=images_tar.name)
        images_tar.unlink()

    print("\n=== [4/4] 打包最终交付物压缩包 ===")
    archive_name = dist_dir / f"mini-pipeline-release-{version}"
    shutil.make_archive(str(archive_name), "zip", dist_dir, f"mini-pipeline-{version}")
    print(f"\n✅ 交付包生成完毕: {archive_name}.zip")


if __name__ == "__main__":
    main()
