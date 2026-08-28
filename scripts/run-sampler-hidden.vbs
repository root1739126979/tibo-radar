Option Explicit

If WScript.Arguments.Count <> 3 Then
    WScript.Quit 64
End If

Dim shell, nodePath, codexPath, sampleScript, commandLine, exitCode
nodePath = WScript.Arguments.Item(0)
codexPath = WScript.Arguments.Item(1)
sampleScript = WScript.Arguments.Item(2)

Set shell = CreateObject("WScript.Shell")
shell.Environment("Process").Item("CODEX_BIN") = codexPath
commandLine = QuoteArgument(nodePath) & " " & QuoteArgument(sampleScript)
exitCode = shell.Run(commandLine, 0, True)
WScript.Quit exitCode

Function QuoteArgument(value)
    If InStr(value, Chr(34)) > 0 Then
        WScript.Quit 64
    End If
    QuoteArgument = Chr(34) & value & Chr(34)
End Function
