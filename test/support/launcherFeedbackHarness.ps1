param([string]$Source, [string]$Scenario)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
# Every external effect of the real launcher is replaced here. Never dot-source
# it outside this harness in a launcher test.
$script:starts = [System.Collections.Generic.List[object]]::new()
$script:notices = [System.Collections.Generic.List[string]]::new()
$script:requests = [System.Collections.Generic.List[string]]::new()
$script:removals = [System.Collections.Generic.List[string]]::new()
$script:stops = 0
$script:runtimeChecks = 0
$script:clock = [datetime]'2026-11-24T12:00:00'
function Get-NetTCPConnection { if ($Scenario -like 'reuse*') { [pscustomobject]@{ OwningProcess = 99999 } } }
function Get-CimInstance { return @() }
function Stop-Process { $script:stops++; throw 'Process termination forbidden in this fixture' }
function Test-Path {
    param($LiteralPath, $Path)
    $target = if ($LiteralPath) { $LiteralPath } else { $Path }
    if ($target -like '*electron.exe') { return $Scenario -ne 'dependencies' }
    return $Scenario -eq 'cooldown'
}
function Get-Item { [pscustomobject]@{ LastWriteTime = $script:clock } }
function Get-Date { $script:clock = $script:clock.AddSeconds(10); return $script:clock }
function Set-Content { }
function Get-Content { return [string]$PID }
function Remove-Item { param($LiteralPath) $script:removals.Add([string]$LiteralPath) }
function Start-Sleep { }
function Start-Process {
    param($FilePath, $WindowStyle, $ArgumentList)
    $script:starts.Add([pscustomobject]@{ file = $FilePath; style = $WindowStyle; arguments = $ArgumentList })
}
function Invoke-RestMethod {
    param($Uri)
    $script:requests.Add([string]$Uri)
    if ($Scenario -eq 'timeout') { throw 'Synthetic local server unavailable' }
    if ($Uri -like '*/runtime') {
        $script:runtimeChecks++
        if ($Scenario -eq 'ipv4-fast' -and $Uri -like 'http://localhost:*') { throw 'Synthetic localhost resolution exceeded the request timeout' }
        if ($Scenario -eq 'late-start' -and $script:clock -lt [datetime]'2026-11-24T12:01:10') { throw 'Synthetic cold startup still in progress' }
        if ($Scenario -eq 'deadline-ready' -and $script:runtimeChecks -lt 9) { throw 'Synthetic server becomes ready at the boundary' }
        if ($Scenario -eq 'invalid-runtime') { return [pscustomobject]@{ success = $true; instanceId = '' } }
        return [pscustomobject]@{ success = $true; instanceId = 'fixture-runtime' }
    }
    if ($Scenario -in @('reuse-fail', 'window-fail')) { throw 'Synthetic desktop unavailable' }
    return [pscustomobject]@{ success = $true }
}
function Add-Type { throw 'Native dialogs deliberately disabled in this fixture' }
function New-Object {
    param($ComObject)
    if ($ComObject -ne 'WScript.Shell') { throw 'Native object forbidden' }
    $fake = [pscustomobject]@{}
    $fake | Add-Member -MemberType ScriptMethod -Name Popup -Value { param($message) $script:notices.Add([string]$message); return 0 }
    return $fake
}
. $Source -NoProgress
[pscustomobject]@{ starts = $script:starts.ToArray(); notices = $script:notices.ToArray(); requests = $script:requests.ToArray();
    removals = $script:removals.ToArray(); stops = $script:stops } | ConvertTo-Json -Depth 8 -Compress
