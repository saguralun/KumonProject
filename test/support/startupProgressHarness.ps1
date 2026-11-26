param([string]$Mode, [string]$ImagePath, [string]$FixtureDirectory)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$sourceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if ($Mode -eq 'state') {
    $script:content = $null; $script:starts = @(); $script:writes = 0
    function New-Item { return $null }
    function Set-Content { param([Parameter(ValueFromPipeline = $true)]$Value, $LiteralPath, $Encoding) process { $script:content = [string]$Value; $script:writes++ } }
    function Get-Content { if (-not $script:content) { throw 'No fixture state yet' }; return $script:content }
    function Start-Process { param($FilePath, $WindowStyle, $ArgumentList) $script:starts += [pscustomobject]@{ style = $WindowStyle; arguments = $ArgumentList } }
    function Get-Process { param($Id) if ($Id -eq $PID) { return [pscustomobject]@{ Id = $PID } } }
    . (Join-Path $sourceRoot 'launcher\launch-progress.ps1')
    $first = Start-KumonLaunchProgress -ProjectDir $sourceRoot
    $initial = $script:content | ConvertFrom-Json
    $second = Start-KumonLaunchProgress -ProjectDir $sourceRoot
    Update-KumonLaunchProgress -Progress $first -Stage starting
    $pending = $script:content | ConvertFrom-Json
    Update-KumonLaunchProgress -Progress $first -Stage ready
    Update-KumonLaunchProgress -Progress $first -Stage error
    $final = $script:content | ConvertFrom-Json
    [pscustomobject]@{ starts = $script:starts; firstPath = $first.Path; initial = $initial; pending = $pending; final = $final;
        secondShared = $second.Shared; sameAttempt = $second.Attempt -eq $first.Attempt; writes = $script:writes } | ConvertTo-Json -Depth 10 -Compress
} elseif ($Mode -eq 'failure') {
    . (Join-Path $sourceRoot 'launcher\launch-feedback.ps1')
    function Get-Content { return '{"attemptId":"fixture-attempt","status":"error"}' }
    function Invoke-RestMethod { throw 'Network requests forbidden after a known module failure' }
    $message = ''
    try { Wait-KumonDesktop -Progress ([pscustomobject]@{ Path = 'fixture-only'; Attempt = 'fixture-attempt' }) }
    catch { $message = $_.Exception.Message }
    [pscustomobject]@{ message = $message } | ConvertTo-Json -Compress
} elseif ($Mode -eq 'actual-viewer') {
    if (-not $FixtureDirectory -or -not (Test-Path -LiteralPath $FixtureDirectory)) { throw 'Missing isolated fixture directory' }
    $env:LOCALAPPDATA = $FixtureDirectory
    . (Join-Path $sourceRoot 'launcher\launch-progress.ps1')
    $progress = Start-KumonLaunchProgress -ProjectDir $sourceRoot
    if (-not $progress.ViewerPid) { throw 'Synthetic progress viewer did not start' }
    $child = Get-Process -Id $progress.ViewerPid
    try {
        $deadline = [datetime]::UtcNow.AddSeconds(15)
        do {
            Start-Sleep -Milliseconds 150; $child.Refresh()
        } while (-not $child.MainWindowHandle -and -not $child.HasExited -and [datetime]::UtcNow -lt $deadline)
        $visible = [bool]$child.MainWindowHandle
        Update-KumonLaunchProgress -Progress $progress -Stage desktop
        Update-KumonLaunchProgress -Progress $progress -Stage ready
        $closed = $child.WaitForExit(10000)
        [pscustomobject]@{ visible = $visible; closedWhenReady = $closed; path = $progress.Path } | ConvertTo-Json -Compress
    } finally {
        $child.Refresh()
        if (-not $child.HasExited) { Stop-Process -Id $child.Id -Force }
        $child.Dispose()
    }
} elseif ($Mode -eq 'view') {
    . (Join-Path $sourceRoot 'launcher\launch-progress-view.ps1')
    $form = New-KumonProgressForm
    try {
        $state = [pscustomobject]@{ stage = 'modules'; startedAt = [datetime]::UtcNow.AddSeconds(-42).ToString('o'); history = @() }
        Set-KumonProgressView -Form $form -State $state
        $form.Show(); [Windows.Forms.Application]::DoEvents()
        if ($ImagePath) {
            $bitmap = New-Object Drawing.Bitmap($form.Width, $form.Height)
            try { $form.DrawToBitmap($bitmap, (New-Object Drawing.Rectangle(0, 0, $form.Width, $form.Height))); $bitmap.Save($ImagePath) }
            finally { $bitmap.Dispose() }
        }
        $stage = $form.Controls['Stage'].Text; $elapsed = $form.Controls['Elapsed'].Text; $hint = $form.Controls['Hint'].Text
        $buttons = @($form.Controls | Where-Object { $_ -is [Windows.Forms.Button] })
        ($buttons | Where-Object { $_.Text -eq 'ซ่อนหน้าต่างนี้' }).PerformClick()
        [pscustomobject]@{ stage = $stage; elapsed = $elapsed; hint = $hint; hidden = -not $form.Visible;
            buttons = @($buttons | ForEach-Object { $_.Text }); diagnostics = [string]$form.Tag } | ConvertTo-Json -Depth 5 -Compress
    } finally { $form.Dispose() }
} else { throw 'Unknown fixture mode' }
