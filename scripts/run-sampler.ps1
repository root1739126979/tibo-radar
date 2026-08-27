param(
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Parameter(Mandatory = $true)][string]$CodexPath,
    [Parameter(Mandatory = $true)][string]$SampleScript
)

$ErrorActionPreference = 'Stop'
$env:CODEX_BIN = $CodexPath
& $NodePath $SampleScript
exit $LASTEXITCODE
