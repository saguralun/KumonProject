' WScript launches PowerShell without tying its console to the Node server being stopped.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
helperPath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "restart-server.ps1")
command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Quote(helperPath)
names = Array("ServerPid", "ProjectDir", "NodePath", "Port", "StatusPath")
If WScript.Arguments.Count <> 5 Then WScript.Quit 1
For i = 0 To 4
    command = command & " -" & names(i) & " " & Quote(WScript.Arguments(i))
Next
shell.Run command, 0, False

Function Quote(value)
    Quote = Chr(34) & value & Chr(34)
End Function
