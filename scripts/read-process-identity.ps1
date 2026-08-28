param(
    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$OwnerProcessId
)

$ErrorActionPreference = 'Stop'
$owner = Get-Process -Id $OwnerProcessId -ErrorAction SilentlyContinue
if (-not $owner) {
    [Console]::Out.Write('MISSING')
    exit 0
}

[Console]::Out.Write($owner.StartTime.ToUniversalTime().Ticks.ToString())
