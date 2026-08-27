param(
    [string]$TaskName = 'TiboRadarQuotaMonitor'
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$sampleScript = Join-Path $projectDirectory 'src\sample.js'
$runnerScript = Join-Path $PSScriptRoot 'run-sampler.ps1'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath $sampleScript -PathType Leaf)) {
    throw "Sample script not found: $sampleScript"
}
$codexPath = (& where.exe codex 2>$null | Where-Object { $_ -like '*.exe' } | Select-Object -Last 1)
if (-not $codexPath -or -not (Test-Path -LiteralPath $codexPath -PathType Leaf)) {
    throw 'The native codex.exe executable could not be located.'
}
foreach ($value in @($nodePath, $codexPath, $sampleScript, $runnerScript)) {
    if ($value.Contains('"')) { throw "Unsupported quote character in task path: $value" }
}

$service = New-Object -ComObject 'Schedule.Service'
$service.Connect()
$folder = $service.GetFolder('\')
$definition = $service.NewTask(0)
$definition.RegistrationInfo.Description = 'Read Codex weekly quota every 10 minutes without using model quota.'
$definition.Principal.UserId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$definition.Principal.LogonType = 3
$definition.Principal.RunLevel = 0

$definition.Settings.Enabled = $true
$definition.Settings.StartWhenAvailable = $true
$definition.Settings.WakeToRun = $true
$definition.Settings.ExecutionTimeLimit = 'PT2M'
$definition.Settings.MultipleInstances = 2
$definition.Settings.DisallowStartIfOnBatteries = $false
$definition.Settings.StopIfGoingOnBatteries = $false

$trigger = $definition.Triggers.Create(1)
$trigger.StartBoundary = (Get-Date).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:ss')
$trigger.Enabled = $true
$trigger.Repetition.Interval = 'PT10M'
$trigger.Repetition.Duration = 'P3650D'
$trigger.Repetition.StopAtDurationEnd = $false

$action = $definition.Actions.Create(0)
$action.Path = (Get-Command powershell.exe -ErrorAction Stop).Source
$action.Arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $runnerScript + '" -NodePath "' + $nodePath + '" -CodexPath "' + $codexPath + '" -SampleScript "' + $sampleScript + '"'
$action.WorkingDirectory = $projectDirectory

$null = $folder.RegisterTaskDefinition($TaskName, $definition, 6, $definition.Principal.UserId, $null, 3)
$task = $folder.GetTask($TaskName)
$null = $task.Run($null)
Write-Output "Installed and started scheduled task: $TaskName"
Write-Output "Interval: 10 minutes"
Write-Output "Node: $nodePath"
Write-Output "Codex: $codexPath"
