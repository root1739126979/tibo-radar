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

$triggerTypes = @($task.Triggers | ForEach-Object { $_.CimClass.CimClassName })
if (-not ($triggerTypes -contains 'MSFT_TaskLogonTrigger')) {
    throw 'Scheduled task does not run when the current user logs on.'
}
$timeTrigger = $task.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskTimeTrigger' } | Select-Object -First 1
if (-not $timeTrigger -or $timeTrigger.Repetition.Interval -ne 'PT10M') {
    throw 'Scheduled task does not repeat every 10 minutes.'
}
if ($task.Settings.RestartCount -ne 3 -or $task.Settings.RestartInterval -ne 'PT1M') {
    throw 'Scheduled task does not retry three times at one-minute intervals.'
}
if ($task.Settings.WakeToRun) { throw 'Scheduled task must not wake a sleeping computer.' }
if (-not $task.Settings.StartWhenAvailable) { throw 'Scheduled task must catch up after sleep or shutdown.' }
if ($task.Settings.MultipleInstances -ne 2) { throw 'Scheduled task must ignore overlapping runs.' }

Write-Output "PASS: $TaskName is hidden, starts at logon, repeats, catches up, and retries safely."
