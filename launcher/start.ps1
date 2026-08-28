# KumonDB launcher — used by start-kumondb.bat (and the desktop shortcut).
# 1) Kills any previous KumonDB dev-server window (marked, even if hidden)
#    plus anything already listening on port 3000, so relaunches never stack.
# 2) Starts the dev server in a fully hidden PowerShell window.
# 3) Waits for it to come up, then opens it in Chrome "app mode" (no
#    tabs/address bar — looks like a standalone desktop app).

$ErrorActionPreference = "SilentlyContinue"

# Derived from this script's own location (launcher\start.ps1) instead of
# hardcoded, so the same file works regardless of which drive/folder the
# project is cloned into on any given machine.
$ProjectDir = Split-Path -Parent $PSScriptRoot
$AppUrl = "http://localhost:3000/login.html"
$Marker = "KUMONDB_LAUNCHER_MARKER"

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

# --- 2) Start the dev server, fully hidden ------------------------------

$serverCommand = "Set-Location -LiteralPath '$ProjectDir'; " +
    "`$host.UI.RawUI.WindowTitle = 'KumonDB Server'; " +
    "# $Marker`n" +
    "npm run dev"

Start-Process powershell -WindowStyle Hidden -ArgumentList @(
    "-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $serverCommand
)

# --- 3) Wait for it to come up (poll instead of a blind sleep) --------

$ready = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
        $ready = $true
        break
    }
}
if (-not $ready) {
    Start-Sleep -Seconds 2
}

# --- 4) Open in Chrome, app mode (no tabs / address bar) ---------------

function Resolve-ChromePath {
    $regPaths = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"
    )
    foreach ($regPath in $regPaths) {
        $value = (Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue).'(default)'
        if ($value -and (Test-Path $value)) { return $value }
    }

    $commonPaths = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    foreach ($path in $commonPaths) {
        if (Test-Path $path) { return $path }
    }

    return $null
}

$chromePath = Resolve-ChromePath

if ($chromePath) {
    # --kiosk-printing skips Chrome's print preview dialog entirely and
    # sends the job straight to whatever is set as the Windows default
    # printer (the receipt layout is already sized for an 80mm thermal
    # printer via @page in payment.css). Only affects this dedicated
    # app-mode window, not the user's regular Chrome.
    Start-Process -FilePath $chromePath -ArgumentList @("--app=$AppUrl", "--start-maximized", "--kiosk-printing")
}
else {
    # Chrome not found anywhere expected — fall back to the OS default
    # handler rather than failing silently.
    Start-Process $AppUrl
}
