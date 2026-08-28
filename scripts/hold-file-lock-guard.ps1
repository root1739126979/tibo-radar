param(
    [Parameter(Mandatory = $true)][ValidatePattern('^Local\\TiboRadarFileLock-[a-f0-9]{64}$')][string]$MutexName,
    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$OwnerProcessId
)

$ErrorActionPreference = 'Stop'
$mutex = New-Object System.Threading.Mutex($false, $MutexName)
$acquired = $false
try {
    try {
        $acquired = $mutex.WaitOne(0)
    }
    catch [System.Threading.AbandonedMutexException] {
        $acquired = $true
    }
    if (-not $acquired) {
        [Console]::Out.WriteLine('BUSY')
        [Console]::Out.Flush()
        exit 75
    }
    $owner = Get-Process -Id $OwnerProcessId -ErrorAction Stop
    $ownerIdentity = $owner.StartTime.ToUniversalTime().Ticks.ToString()
    [Console]::Out.WriteLine("ACQUIRED:$ownerIdentity")
    [Console]::Out.Flush()
    $null = [Console]::In.ReadLine()
}
finally {
    if ($acquired) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
