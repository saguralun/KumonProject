' Runs start-kumondb.bat with its window fully hidden, so double-clicking
' the KumonDB desktop shortcut never flashes a console window at all.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
batPath = fso.BuildPath(scriptDir, "..\start-kumondb.bat")
shell.Run """" & batPath & """", 0, False
