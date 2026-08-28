param(
    [string]$TaskName = 'TiboRadarQuotaMonitor'
)

$ErrorActionPreference = 'Stop'
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
$action = $task.Actions | Select-Object -First 1
$expectedHost = Join-Path $env:SystemRoot 'System32\wscript.exe'

if (-not [string]::Equals($action.Execute, $expectedHost, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Scheduled task uses a console host: $($action.Execute)"
}
if ($action.Arguments -notmatch '(?i)run-sampler-hidden\.vbs') {
    throw "Scheduled task does not use the hidden sampler runner: $($action.Arguments)"
}

$runnerPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\run-sampler-hidden.vbs'
if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) {
    throw "Hidden sampler runner is missing: $runnerPath"
}
$runnerSource = Get-Content -Raw -LiteralPath $runnerPath
if ($runnerSource -notmatch '(?i)\.Run\(commandLine,\s*0,\s*True\)') {
    throw 'Hidden sampler runner does not force window style 0.'
}

Write-Output "PASS: $TaskName uses an invisible Windows Script Host action."
