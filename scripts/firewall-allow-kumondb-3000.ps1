# Run this file in Windows PowerShell as Administrator.
$ErrorActionPreference = "Stop"

$ruleName = "KumonDB Node Server TCP 3000"
$port = 3000

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Please run Windows PowerShell as Administrator before running this script."
}

$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

if ($rule) {
  Set-NetFirewallRule -DisplayName $ruleName -Enabled True -Direction Inbound -Action Allow -Profile Private
  Get-NetFirewallRule -DisplayName $ruleName | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $port
  Get-NetFirewallRule -DisplayName $ruleName | Set-NetFirewallAddressFilter -RemoteAddress LocalSubnet
  Get-NetFirewallRule -DisplayName $ruleName | Set-NetFirewallApplicationFilter -Program $nodePath
} else {
  New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $port `
    -Program $nodePath `
    -Profile Private `
    -RemoteAddress LocalSubnet `
    -EdgeTraversalPolicy Block | Out-Null
}

Write-Host "Firewall rule is ready: $ruleName"
Write-Host "Allowed: TCP $port, Private networks only, LocalSubnet only, Node.js only"
