param(
    [string]$TaskName = 'TiboRadarQuotaMonitor'
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$sampleScript = Join-Path $projectDirectory 'src\sample.js'
$runnerScript = Join-Path $PSScriptRoot 'run-sampler-hidden.vbs'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$wscriptPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$backupDirectory = Join-Path $projectDirectory 'data\backups'
$backupPath = Join-Path $backupDirectory "$TaskName-before-app.xml"
foreach ($requiredFile in @($sampleScript, $runnerScript, $nodePath, $wscriptPath)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required file not found: $requiredFile"
    }
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
$existingTask = $null
try { $existingTask = $folder.GetTask($TaskName) } catch { }
if ($existingTask) {
    [IO.Directory]::CreateDirectory($backupDirectory) | Out-Null
    [IO.File]::WriteAllText($backupPath, $existingTask.Xml, [Text.UTF8Encoding]::new($false))
}
$definition = $service.NewTask(0)
$definition.RegistrationInfo.Description = 'Read Codex weekly quota every 10 minutes without using model quota.'
$definition.Principal.UserId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$definition.Principal.LogonType = 3
$definition.Principal.RunLevel = 0

$definition.Settings.Enabled = $true
$definition.Settings.StartWhenAvailable = $true
$definition.Settings.WakeToRun = $false
$definition.Settings.ExecutionTimeLimit = 'PT2M'
$definition.Settings.MultipleInstances = 2
$definition.Settings.RestartCount = 3
$definition.Settings.RestartInterval = 'PT1M'
$definition.Settings.DisallowStartIfOnBatteries = $false
$definition.Settings.StopIfGoingOnBatteries = $false

$trigger = $definition.Triggers.Create(1)
$trigger.StartBoundary = (Get-Date).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:ss')
$trigger.Enabled = $true
$trigger.Repetition.Interval = 'PT10M'
$trigger.Repetition.Duration = 'P3650D'
$trigger.Repetition.StopAtDurationEnd = $false

$logonTrigger = $definition.Triggers.Create(9)
$logonTrigger.UserId = $definition.Principal.UserId
$logonTrigger.Enabled = $true

$action = $definition.Actions.Create(0)
$action.Path = $wscriptPath
$action.Arguments = '"' + $runnerScript + '" "' + $nodePath + '" "' + $codexPath + '" "' + $sampleScript + '"'
$action.WorkingDirectory = $projectDirectory

$null = $folder.RegisterTaskDefinition($TaskName, $definition, 6, $definition.Principal.UserId, $null, 3)
$task = $folder.GetTask($TaskName)
$null = $task.Run($null)
Write-Output "Installed and started scheduled task: $TaskName"
Write-Output "Interval: 10 minutes"
Write-Output "Logon start: enabled"
Write-Output "Failure retries: 3 at one-minute intervals"
Write-Output "Wake sleeping computer: disabled"
Write-Output "Node: $nodePath"
Write-Output "Codex: $codexPath"
