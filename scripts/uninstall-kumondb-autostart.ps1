$ErrorActionPreference = "Stop"

$taskName = "KumonDB Server"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($task) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "Removed auto-start task: $taskName"
} else {
  Write-Host "Auto-start task was not found: $taskName"
}
