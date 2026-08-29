$paths = @(
    "$env:APPDATA\Antigravity\User\settings.json",
    "$env:APPDATA\Antigravity IDE\User\settings.json",
    "$env:APPDATA\Antigravity\User",
    "$env:APPDATA\Antigravity IDE\User"
)

Write-Host "`n=== Antigravity 配置检测 ===" -ForegroundColor Cyan

foreach ($p in $paths) {
    if (Test-Path $p) {
        Write-Host "[FOUND] $p" -ForegroundColor Green
    } else {
        Write-Host "[----]  $p" -ForegroundColor DarkGray
    }
}

Write-Host "`n=== Antigravity 相关目录 ===" -ForegroundColor Cyan

Get-ChildItem $env:APPDATA -Directory -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -match "Antigravity"
    } |
    Select-Object FullName

Write-Host "`n=== 完成 ===" -ForegroundColor Cyan