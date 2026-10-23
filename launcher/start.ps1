param(
    [switch]$ForceRestart
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

# Do not replace a running server, browser session, or unsaved KSIS work.
if (-not $ForceRestart -and (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {
    try {
        $result = Invoke-RestMethod -Uri "http://localhost:3000/api/system/desktop/show" -Method Post -ContentType "application/json" -Body "{}" -TimeoutSec 40 -ErrorAction Stop
        if (-not $result.success) { throw "Desktop not available" }
    } catch {
        Write-Warning "KumonDB is already running. Finish pending work before using -ForceRestart to activate the integrated desktop."
    }
    return
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectDir 'node_modules/electron/dist/electron.exe'))) {
    Write-Warning "KumonDB desktop dependencies are missing. Install dependencies before opening the application."
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
    if ($ageSeconds -lt 30) { return }
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

$serverCommand = "Set-Location -LiteralPath '$ProjectDir'; " +
    "`$env:KUMON_DESKTOP_MAIN = '1'; " +
    "`$host.UI.RawUI.WindowTitle = 'KumonDB Server'; " +
    "# $Marker`n" +
    "npm start"

Start-Process powershell -WindowStyle Hidden -ArgumentList @(
    "-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $serverCommand
)

# The server owns the integrated desktop. Do not open Chrome or another window.
