$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$scriptPath = Join-Path $projectDirectory 'src\clear-diagnostics.js'
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
    throw "Diagnostic cleanup entry is missing: $scriptPath"
}
& $nodePath $scriptPath
exit $LASTEXITCODE
