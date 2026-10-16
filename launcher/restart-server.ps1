param(
    [Parameter(Mandatory = $true)][int]$ServerPid,
    [Parameter(Mandatory = $true)][string]$ProjectDir,
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][string]$StatusPath,
    [int]$StartupTimeoutSeconds = 45
)

$ErrorActionPreference = "Stop"

function Write-RestartLog([string]$Message) {
    Add-Content -LiteralPath $StatusPath -Value "$(Get-Date -Format o) $Message"
}

function Read-Runtime {
    try {
        Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/system/runtime" -TimeoutSec 1
    } catch { return $null }
}

try {
    if (-not (Test-Path -LiteralPath $NodePath)) { throw "Node executable not found: $NodePath" }
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectDir "server.js"))) { throw "server.js not found" }
    Write-RestartLog "READY oldPid=$ServerPid port=$Port"
    Start-Sleep -Seconds 2

    $oldProcess = Get-Process -Id $ServerPid -ErrorAction SilentlyContinue
    if ($oldProcess) {
        if ($oldProcess.Path -ne $NodePath) { throw "Refusing to stop a different executable" }
        Stop-Process -Id $ServerPid -Force
        $oldProcess.WaitForExit(10000) | Out-Null
    }

    # Start Node directly: no npm.ps1, shell PATH, launcher cooldown, or browser window.
    $env:PORT = [string]$Port
    $logDir = Split-Path -Parent $StatusPath
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
    $server = Start-Process -FilePath $NodePath -ArgumentList "server.js" `
        -WorkingDirectory $ProjectDir -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logDir "server-$stamp.log") `
        -RedirectStandardError (Join-Path $logDir "server-$stamp-error.log")
    $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    do {
        $runtime = Read-Runtime
        if ($runtime.instanceId -and $runtime.processId -ne $ServerPid) {
            Write-RestartLog "SUCCESS newPid=$($runtime.processId) instance=$($runtime.instanceId)"
            exit 0
        }
        if ($server.HasExited) { throw "New server exited; check server-$stamp-error.log" }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "New server did not become ready within $StartupTimeoutSeconds seconds"
} catch {
    Write-RestartLog "ERROR $($_.Exception.Message)"
    exit 1
}
