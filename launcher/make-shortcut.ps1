# Creates/updates the "KumonDB" desktop shortcut.
# Re-run this any time (e.g. after regenerating the icon) to refresh it.

$launcherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "KumonDB.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = '"' + (Join-Path $launcherDir "run-hidden.vbs") + '"'
$shortcut.WorkingDirectory = Split-Path -Parent $launcherDir
$shortcut.IconLocation = (Join-Path $launcherDir "kumondb.ico")
$shortcut.Description = "Open KumonDB"
$shortcut.Save()

Write-Host "Shortcut created at $shortcutPath"
