$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $projectRoot "logs"
$logFile = Join-Path $logDir ("kumondb-" + (Get-Date -Format "yyyyMMdd") + ".log")

if (-not $env:HOST) {
  $env:HOST = "0.0.0.0"
}

if (-not $env:PORT) {
  $env:PORT = "3000"
}

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Push-Location $projectRoot

try {
  "[$(Get-Date -Format s)] Starting KumonDB on $env:HOST`:$env:PORT" | Tee-Object -FilePath $logFile -Append
  npm.cmd start 2>&1 | Tee-Object -FilePath $logFile -Append
} finally {
  Pop-Location
}
