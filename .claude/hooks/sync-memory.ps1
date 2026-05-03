# sync-memory.ps1 — bidirectional sync between Claude Code memory store and OneDrive backup
#
# Usage:
#   .\sync-memory.ps1 -Mode Backup   # Memory → workspace/.memory_backup (Stop hook)
#   .\sync-memory.ps1 -Mode Restore  # workspace/.memory_backup → Memory (SessionStart, only if empty)
#
# Why two directions:
#   - Backup runs every Stop event, mirrors latest memory state to OneDrive (sync to cloud automatic)
#   - Restore runs on SessionStart, kicks in only when local memory is missing (new machine /
#     fresh install / disk failure recovery), pulling state from OneDrive workspace
#
# Exit code: 0 always — never block Claude Code execution on backup failure

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("Backup", "Restore")]
    [string]$Mode
)

$ErrorActionPreference = "Continue"

# Paths (PSLink Project — note space in workspace folder name)
$workspace = "C:\Users\kumic\OneDrive\Desktop\Dev\PSLink Project"
$memoryRoot = "$env:USERPROFILE\.claude\projects\c--Users-kumic-OneDrive-Desktop-Dev-PSLink-Project\memory"
$backupDir = "$workspace\.memory_backup"
$logFile = "$backupDir\sync.log"

function Write-SyncLog {
    param([string]$Message)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts][$Mode] $Message"
    if (Test-Path $backupDir) {
        Add-Content -Path $logFile -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
    }
}

if ($Mode -eq "Backup") {
    if (-not (Test-Path $memoryRoot)) {
        Write-SyncLog "skip: source memory folder does not exist ($memoryRoot)"
        exit 0
    }
    if (-not (Test-Path $backupDir)) {
        New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    }
    $result = robocopy $memoryRoot $backupDir /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 2>&1
    $rc = $LASTEXITCODE
    if ($rc -lt 8) {
        $files = (Get-ChildItem $backupDir -Filter "*.md" -ErrorAction SilentlyContinue).Count
        Write-SyncLog "backup OK: $files .md files mirrored (rc=$rc)"
    } else {
        Write-SyncLog "backup FAIL: rc=$rc"
    }
    exit 0
}

if ($Mode -eq "Restore") {
    if (-not (Test-Path $backupDir)) {
        Write-SyncLog "skip: no backup folder ($backupDir)"
        exit 0
    }
    $backupFiles = Get-ChildItem $backupDir -Filter "*.md" -ErrorAction SilentlyContinue
    if ($backupFiles.Count -eq 0) {
        Write-SyncLog "skip: backup folder has no .md files"
        exit 0
    }
    if (-not (Test-Path $memoryRoot)) {
        New-Item -ItemType Directory -Path $memoryRoot -Force | Out-Null
        Write-SyncLog "created memory folder: $memoryRoot"
    }
    $localFiles = Get-ChildItem $memoryRoot -Filter "*.md" -ErrorAction SilentlyContinue
    if ($localFiles.Count -gt 0) {
        Write-SyncLog "skip restore: local memory has $($localFiles.Count) .md files (not empty)"
        exit 0
    }
    $result = robocopy $backupDir $memoryRoot /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 /XF "sync.log" 2>&1
    $rc = $LASTEXITCODE
    if ($rc -lt 8) {
        Write-SyncLog "restore OK: $($backupFiles.Count) files restored to memory store (rc=$rc)"
    } else {
        Write-SyncLog "restore FAIL: rc=$rc"
    }
    exit 0
}
