# KumonDB launcher — used by start-kumondb.bat (and the desktop shortcut).
# 0) If another launch fired in the last 30s, do nothing — this is what
#    stops an impatient double/triple-click from killing the server that is
#    already booting (and stacking up extra windows).
# 1) Kills any previous KumonDB dev-server window (marked, even if hidden)
#    plus anything already listening on port 3000, so relaunches never stack.
# 2) Starts the dev server in a fully hidden PowerShell window.
# 3) Immediately opens Chrome "app mode" on launcher\loading.html — a splash
#    with a progress bar that shows while the server boots and forwards
#    itself to the login page the moment the server answers. The user sees a
#    window in well under a second instead of staring at nothing for 5-7s.

$ErrorActionPreference = "SilentlyContinue"

# Derived from this script's own location (launcher\start.ps1) instead of
# hardcoded, so the same file works regardless of which drive/folder the
# project is cloned into on any given machine.
$ProjectDir = Split-Path -Parent $PSScriptRoot
$LoginUrl = "http://localhost:3000/login.html"
$Marker = "KUMONDB_LAUNCHER_MARKER"

# --- 0) Ignore rapid re-launches -------------------------------------

# One lock file, gated purely by its age. We deliberately do NOT delete it
# when this script finishes: the 30s window is a cool-down during which
# repeat double-clicks are treated as "it's already coming up, hold on".
# A genuine restart is still possible once the window has passed.
$LockFile = Join-Path $env:TEMP "kumondb-launcher.lock"
if (Test-Path $LockFile) {
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

# --- 2) Start the dev server, fully hidden ------------------------------

$serverCommand = "Set-Location -LiteralPath '$ProjectDir'; " +
    "`$host.UI.RawUI.WindowTitle = 'KumonDB Server'; " +
    "# $Marker`n" +
    "npm run dev"

Start-Process powershell -WindowStyle Hidden -ArgumentList @(
    "-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $serverCommand
)

# --- 3) Open the splash immediately -----------------------------------

# file:// URL for launcher\loading.html, space-safe. The splash itself
# waits for the server and forwards to $LoginUrl — no blind Start-Sleep
# here, so the window appears right away.
$LoadingUrl = "file:///" + (($PSScriptRoot -replace '\\', '/') -replace ' ', '%20') + "/loading.html"

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
    Start-Process -FilePath $chromePath -ArgumentList @("--app=$LoadingUrl", "--start-maximized", "--kiosk-printing")
}
else {
    # Chrome not found anywhere expected — no splash window in this path,
    # so fall back to polling here and then hand the login URL straight to
    # the OS default handler.
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { break }
    }
    Start-Process $LoginUrl
}
