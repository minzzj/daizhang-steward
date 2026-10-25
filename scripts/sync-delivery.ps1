# 交付快照同步 / Delivery snapshot sync
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sync-delivery.ps1 [-WhatIf]
# NOTE: This file MUST be saved as UTF-8 **with BOM** — Windows PowerShell 5.1 reads
#       BOM-less files as ANSI and would corrupt the Chinese target path.
# Copies SOURCE files (no .git / node_modules / runtime artifacts) from the
# authoritative NTFS build directory to the H: delivery folder.
# H: is exFAT: don't develop there (no symlinks, atomic-write issues), only keep copies.

[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = "Stop"

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$Delivery   = "H:\minzzj文件\技术部\项目\官方\代掌\交付\repo"
$AllowedRoot = "H:\minzzj文件\技术部\项目\官方\代掌\交付\"

if (-not $PSCmdlet.ShouldProcess($Delivery, "sync delivery snapshot")) { return }

# Safety: never mirror outside the project's delivery folder.
$full = [System.IO.Path]::GetFullPath($Delivery)
if (-not $full.StartsWith([System.IO.Path]::GetFullPath($AllowedRoot), [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to sync: target '$full' is outside '$AllowedRoot'."
}
New-Item -ItemType Directory -Force -Path $full | Out-Null

$excludeDirs = @(".git", "node_modules", "runs", "dist", "coverage", "browser-screenshots", "test-results", "playwright-report", ".pnpm-store")
$excludeFiles = @("*.log", "*.tsbuildinfo")

$argList = @(
  $RepoRoot, $full,
  "/E", "/NFL", "/NDL", "/NJH", "/NJS",
  "/XD"
) + $excludeDirs + @("/XF") + $excludeFiles

Write-Host "source : $RepoRoot"
Write-Host "target : $full"
if ($WhatIfPreference) { Write-Host "(WhatIf: nothing copied)" }

$robo = Start-Process -FilePath "robocopy.exe" -ArgumentList $argList -Wait -PassThru -NoNewWindow
if ($robo.ExitCode -ge 8) {
  throw "robocopy failed with exit code $($robo.ExitCode)"
}

$gitRev = "unknown"
try { $gitRev = (git -C $RepoRoot rev-parse --short HEAD 2>$null).Trim() } catch {}
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$manifest = @(
  "daizhang-steward delivery snapshot",
  "source : $RepoRoot",
  "target : $full",
  "git    : $gitRev",
  "time   : $stamp",
  "",
  "This folder is a READ-ONLY copy for delivery/review.",
  "The authoritative repository lives on NTFS at the build path above.",
  "H: is exFAT: do not develop here (no symlinks / atomic writes)."
)
Set-Content -LiteralPath (Join-Path $full "_snapshot-info.txt") -Value $manifest -Encoding utf8
Write-Host "OK: snapshot synced ($stamp)."
