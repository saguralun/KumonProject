param(
    [switch]$ForceRestart,
    [switch]$NoProgress
)

# KumonDB launcher — used by start-kumondb.bat (and the desktop shortcut).
# 0) If another launch fired in the last 30s, do nothing — this is what
#    stops an impatient double/triple-click from killing the server that is
#    already booting (and stacking up extra windows).
# 1) Reuses the existing app unless an explicit restart was requested.
# 2) Starts the server in a fully hidden PowerShell window.
# 3) Node opens the single integrated desktop after the server is ready.

$ErrorActionPreference = "SilentlyContinue"

# Derived from this script's own location (launcher\start.ps1) instead of
# hardcoded, so the same file works regardless of which drive/folder the
# project is cloned into on any given machine.
$ProjectDir = Split-Path -Parent $PSScriptRoot
$Marker = "KUMONDB_LAUNCHER_MARKER"
. (Join-Path $PSScriptRoot 'launch-feedback.ps1')
. (Join-Path $PSScriptRoot 'launch-progress.ps1')
$progress = if (-not $NoProgress) { Start-KumonLaunchProgress -ProjectDir $ProjectDir } else { $null }
if ($progress.Shared) { return } # A second double-click shares the pending launch.

# Do not replace a running server, browser session, or unsaved KSIS work.
if (-not $ForceRestart -and (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {
    try {
        Update-KumonLaunchProgress -Progress $progress -Stage desktop
        Open-KumonDesktopWindow
        Update-KumonLaunchProgress -Progress $progress -Stage ready
    } catch {
        Update-KumonLaunchProgress -Progress $progress -Stage error
        Show-KumonLaunchError -Stage 'reuse' -ProjectDir $ProjectDir -Detail $_.Exception.Message
    }
    return
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectDir 'node_modules/electron/dist/electron.exe'))) {
    Update-KumonLaunchProgress -Progress $progress -Stage error
    Show-KumonLaunchError -Stage 'dependencies' -ProjectDir $ProjectDir -Detail 'Desktop dependencies are missing or an update did not finish.'
    return
}

# --- 0) Ignore rapid re-launches -------------------------------------

# One lock file, gated purely by its age. We deliberately do NOT delete it
# when this script finishes: the 30s window is a cool-down during which
# repeat double-clicks are treated as "it's already coming up, hold on".
# A genuine restart is still possible once the window has passed.
$LockFile = Join-Path $env:TEMP "kumondb-launcher.lock"
if (-not $ForceRestart -and (Test-Path $LockFile)) {
    $ageSeconds = ((Get-Date) - (Get-Item $LockFile).LastWriteTime).TotalSeconds
    if ($ageSeconds -lt 30) { Update-KumonLaunchProgress -Progress $progress -Stage ready; return }
}
Set-Content -Path $LockFile -Value $PID -Force

# --- 1) Close any previous launch --------------------------------------

# Kill earlier hidden server windows by matching the marker we tag them
# with below (CommandLine-based, so this finds them even fully hidden).
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($Marker) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# Also free port 3000 in case a server is running some other way.
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { if ($_) { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }

# --- 2) Start the server, fully hidden ----------------------------------

$quotedProjectDir = $ProjectDir.Replace("'", "''")
$progressEnvironment = ''
if ($progress) {
    $quotedStatus = $progress.Path.Replace("'", "''")
    $progressEnvironment = "`$env:KUMON_STARTUP_STATUS = '$quotedStatus'; `$env:KUMON_STARTUP_ATTEMPT = '$($progress.Attempt)'; "
}
$serverCommand = "Set-Location -LiteralPath '$quotedProjectDir'; " +
    "`$env:KUMON_DESKTOP_MAIN = '1'; " +
    "`$host.UI.RawUI.WindowTitle = 'KumonDB Server'; " +
    $progressEnvironment + "# $Marker`n" +
    "node launcher/server-entry.mjs"

try {
    Update-KumonLaunchProgress -Progress $progress -Stage starting
    Start-Process powershell -WindowStyle Hidden -ArgumentList @(
        "-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $serverCommand
    ) -ErrorAction Stop
    Wait-KumonDesktop -Progress $progress
    Update-KumonLaunchProgress -Progress $progress -Stage ready
} catch {
    Update-KumonLaunchProgress -Progress $progress -Stage error
    if ((Get-Content -LiteralPath $LockFile -ErrorAction SilentlyContinue) -eq [string]$PID) {
        Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue
    }
    Show-KumonLaunchError -Stage 'start' -ProjectDir $ProjectDir -Detail $_.Exception.Message
}

# The server owns the integrated desktop. Do not open Chrome or another window.
