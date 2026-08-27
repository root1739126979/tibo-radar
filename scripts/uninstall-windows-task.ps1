param(
    [string]$TaskName = 'TiboRadarQuotaMonitor'
)

$ErrorActionPreference = 'Stop'
$service = New-Object -ComObject 'Schedule.Service'
$service.Connect()
$folder = $service.GetFolder('\')
try {
    $folder.DeleteTask($TaskName, 0)
    Write-Output "Removed scheduled task: $TaskName"
}
catch {
    if ($_.Exception.Message -match 'cannot find') {
        Write-Output "Scheduled task was not installed: $TaskName"
    }
    else {
        throw
    }
}
