#!/bin/bash
# ==============================================================================
# Mini Pipeline 运维一键部署脚本 (Linux / macOS)
# ==============================================================================
set -euo pipefail

echo ">>> [1/4] 检查 Docker 与 Docker Compose 环境..."
if ! command -v docker >/dev/null 2>&1; then
    echo "错误: 未找到 docker 命令，请先安装 Docker: https://docs.docker.com/engine/install/" >&2
    exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
    echo "错误: 未找到 docker compose 插件，请安装 Docker Compose v2" >&2
    exit 1
fi

echo ">>> [2/4] 检查并导入离线镜像包（若存在）..."
shopt -s nullglob
IMAGE_ARCHIVES=(mini-pipeline-images-*.tar.gz mini-pipeline-images-*.tar)
if [ ${#IMAGE_ARCHIVES[@]} -gt 0 ]; then
    for arch in "${IMAGE_ARCHIVES[@]}"; do
        echo "发现离线镜像包: $arch，正在导入 Docker..."
        docker load -i "$arch"
    done
else
    echo "未发现本地离线镜像包，将直接从镜像仓库拉取或使用本地现有镜像。"
fi

echo ">>> [3/4] 检查环境配置文件 (.env)..."
if [ ! -f ".env" ]; then
    echo "未检测到 .env 文件，正在从 .env.example 生成..."
    cp .env.example .env
    
    # 自动生成 32 位随机密钥
    ADMIN_TOKEN=$(head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 32)
    READER_TOKEN=$(head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 32)
    SECRET_KEY=$(head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 32)
    
    sed -i "s/REPLACE_WITH_A_SECURE_RANDOM_ADMIN_TOKEN/${ADMIN_TOKEN}/g" .env
    sed -i "s/REPLACE_WITH_A_SECURE_RANDOM_READER_TOKEN/${READER_TOKEN}/g" .env
    sed -i "s/REPLACE_WITH_A_SECURE_RANDOM_FERNET_SECRET_KEY/${SECRET_KEY}/g" .env
    echo "已自动生成高强度安全凭证并写入 .env。"
fi

echo ">>> [4/4] 启动服务容器..."
docker compose up -d

echo "--------------------------------------------------"
echo "等待服务就绪..."
sleep 3
docker compose ps

echo "=================================================="
echo "Mini Pipeline 服务已启动成功！"
echo "Web 控制台访问入口: http://localhost:$(grep -E '^FRONTEND_PORT=' .env | cut -d '=' -f2 || echo 80)"
echo "API 健康检查探针:  http://localhost:$(grep -E '^API_PORT=' .env | cut -d '=' -f2 || echo 8000)/health"
echo "查看实时运行日志:  docker compose logs -f"
echo "停止服务命令:      docker compose down"
echo "=================================================="
