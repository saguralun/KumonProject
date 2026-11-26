function Start-KumonLaunchProgress {
    param([string]$ProjectDir)
    try {
        $projectPath = [System.IO.Path]::GetFullPath($ProjectDir).ToLowerInvariant()
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try { $hash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectPath))).Replace('-', '').ToLowerInvariant().Substring(0, 12) }
        finally { $sha.Dispose() }
        $directory = Join-Path $env:LOCALAPPDATA 'KumonDB\startup'
        New-Item -ItemType Directory -Path $directory -Force -ErrorAction Stop | Out-Null
        $file = Join-Path $directory "$hash.json"
        try {
            $existing = Get-Content -LiteralPath $file -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json
            $age = ([datetime]::UtcNow - [datetime]::Parse($existing.startedAt).ToUniversalTime()).TotalSeconds
            if ($existing.status -eq 'loading' -and $age -lt 150 -and $existing.launcherPid -and
                (Get-Process -Id $existing.launcherPid -ErrorAction SilentlyContinue)) {
                return [pscustomobject]@{ Path = $file; Attempt = $existing.attemptId; Shared = $true }
            }
        } catch { }
        $attempt = [guid]::NewGuid().ToString()
        $state = [ordered]@{ version = 1; attemptId = $attempt; launcherPid = $PID; startedAt = [datetime]::UtcNow.ToString('o');
            updatedAt = [datetime]::UtcNow.ToString('o'); stage = 'checking'; status = 'loading'; elapsedMs = 0;
            history = @(@{ stage = 'checking'; elapsedMs = 0 }) }
        $state | ConvertTo-Json -Depth 6 -Compress | Set-Content -LiteralPath $file -Encoding UTF8 -ErrorAction Stop
        # A separate, lightweight window keeps animating while server requests
        # or Windows process enumeration are waiting. It never owns the server.
        $viewer = Join-Path $PSScriptRoot 'launch-progress-view.ps1'
        $viewerProcess = Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-File', "`"$viewer`"", '-StatusFile', "`"$file`"", '-AttemptId', $attempt, '-OwnerPid', $PID) -ErrorAction Stop
        return [pscustomobject]@{ Path = $file; Attempt = $attempt; ViewerPid = $viewerProcess.Id }
    } catch { return $null } # Optional feedback must not block a normal launch.
}

function Update-KumonLaunchProgress {
    param($Progress, [ValidateSet('checking', 'starting', 'desktop', 'ready', 'error')][string]$Stage)
    if (-not $Progress) { return }
    try {
        $state = Get-Content -LiteralPath $Progress.Path -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json
        if ($state.attemptId -ne $Progress.Attempt -or $state.status -ne 'loading' -or $state.stage -eq $Stage) { return }
        $state.elapsedMs = [Math]::Max(0, [Math]::Round(([datetime]::UtcNow - [datetime]::Parse($state.startedAt).ToUniversalTime()).TotalMilliseconds))
        $state.updatedAt = [datetime]::UtcNow.ToString('o')
        $state.stage = $Stage
        if ($Stage -in @('ready', 'error')) { $state.status = $Stage }
        $state.history = @($state.history) + @(@{ stage = $Stage; elapsedMs = $state.elapsedMs })
        $state | ConvertTo-Json -Depth 6 -Compress | Set-Content -LiteralPath $Progress.Path -Encoding UTF8 -ErrorAction Stop
    } catch { }
}
