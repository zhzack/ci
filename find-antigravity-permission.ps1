$root = "$env:APPDATA\Antigravity IDE\User"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Antigravity Permission Config Scanner" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Root: $root"
Write-Host ""

if (-not (Test-Path $root)) {
    Write-Host "[ERROR] User directory not found!" -ForegroundColor Red
    exit 1
}

Write-Host "[1] Directory structure" -ForegroundColor Yellow
Get-ChildItem $root -Recurse -Depth 2 -ErrorAction SilentlyContinue |
    Select-Object FullName, Length |
    Format-Table -AutoSize

Write-Host ""
Write-Host "[2] Searching permission-related files" -ForegroundColor Yellow

$files = Get-ChildItem $root -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Extension -in @(
            ".json",
            ".jsonc",
            ".db",
            ".sqlite",
            ".sqlite3"
        ) -or
        $_.Name -match "state|setting|config|storage|permission"
    }

$files |
    Select-Object FullName, Length |
    Format-Table -AutoSize

Write-Host ""
Write-Host "[3] Searching permission keywords" -ForegroundColor Yellow

$keywords = @(
    "always-proceed",
    "always proceed",
    "alwaysProceed",
    "autoExecution",
    "auto-execution",
    "auto_execute",
    "terminalAuto",
    "terminal.auto",
    "terminal",
    "permission",
    "strictMode",
    "strict-mode",
    "review"
)

foreach ($file in $files) {

    # 跳过明显的二进制数据库，避免乱码
    if ($file.Extension -in @(".db", ".sqlite", ".sqlite3")) {
        continue
    }

    try {
        $matches = Select-String `
            -Path $file.FullName `
            -Pattern $keywords `
            -SimpleMatch `
            -CaseSensitive:$false `
            -ErrorAction SilentlyContinue

        if ($matches) {
            Write-Host ""
            Write-Host "FOUND: $($file.FullName)" -ForegroundColor Green

            foreach ($m in $matches | Select-Object -First 20) {
                Write-Host "  Line $($m.LineNumber): $($m.Line.Trim())"
            }
        }
    }
    catch {
        # 忽略无法读取的文件
    }
}

Write-Host ""
Write-Host "[4] Antigravity directories" -ForegroundColor Yellow

Get-ChildItem "$env:APPDATA\Antigravity IDE" -Recurse -Directory -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -match "globalStorage|workspaceStorage|User"
    } |
    Select-Object FullName |
    Format-Table -AutoSize

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Scan complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan