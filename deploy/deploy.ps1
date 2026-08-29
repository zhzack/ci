# ==============================================================================
# Mini Pipeline 运维一键部署脚本 (Windows PowerShell)
# ==============================================================================
$ErrorActionPreference = "Stop"

Write-Host ">>> [1/4] 检查 Docker 与 Docker Compose 环境..." -ForegroundColor Cyan
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "错误: 未找到 docker 命令，请先安装 Docker Desktop: https://docs.docker.com/desktop/setup/install/windows-install/"
    exit 1
}

Write-Host ">>> [2/4] 检查并导入离线镜像包（若存在）..." -ForegroundColor Cyan
$imageFiles = Get-ChildItem -Path . -Filter "mini-pipeline-images-*.tar*" -ErrorAction SilentlyContinue
if ($imageFiles.Count -gt 0) {
    foreach ($file in $imageFiles) {
        Write-Host "发现离线镜像包: $($file.Name)，正在导入 Docker..." -ForegroundColor Yellow
        docker load -i $file.FullName
    }
} else {
    Write-Host "未发现本地离线镜像包，将直接从镜像仓库拉取或使用本地现有镜像。" -ForegroundColor Gray
}

Write-Host ">>> [3/4] 检查环境配置文件 (.env)..." -ForegroundColor Cyan
if (-not (Test-Path ".env")) {
    Write-Host "未检测到 .env 文件，正在从 .env.example 生成..." -ForegroundColor Yellow
    Copy-Item .env.example .env

    # 随机生成 32 位安全密钥
    function New-RandomKey {
        $bytes = New-Object byte[] 24
        (New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($bytes)
        return [System.Convert]::ToBase64String($bytes) -replace '[+/=]', 'x'
    }

    $adminToken = New-RandomKey
    $readerToken = New-RandomKey
    $secretKey = New-RandomKey

    (Get-Content .env) `
        -replace 'REPLACE_WITH_A_SECURE_RANDOM_ADMIN_TOKEN', $adminToken `
        -replace 'REPLACE_WITH_A_SECURE_RANDOM_READER_TOKEN', $readerToken `
        -replace 'REPLACE_WITH_A_SECURE_RANDOM_FERNET_SECRET_KEY', $secretKey |
        Set-Content .env
    Write-Host "已自动生成高强度安全凭证并写入 .env。" -ForegroundColor Green
}

Write-Host ">>> [4/4] 启动服务容器..." -ForegroundColor Cyan
docker compose up -d

Write-Host "--------------------------------------------------"
Start-Sleep -Seconds 3
docker compose ps

Write-Host "==================================================" -ForegroundColor Green
Write-Host "Mini Pipeline 服务已启动成功！" -ForegroundColor Green
Write-Host "Web 控制台访问入口: http://localhost:80" -ForegroundColor White
Write-Host "API 健康检查探针:  http://localhost:8000/health" -ForegroundColor White
Write-Host "查看实时运行日志:  docker compose logs -f" -ForegroundColor White
Write-Host "停止服务命令:      docker compose down" -ForegroundColor White
Write-Host "==================================================" -ForegroundColor Green
