$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$restrictedPath = @(
    (Split-Path -Parent $nodePath),
    (Join-Path $env:SystemRoot 'System32'),
    $env:SystemRoot
) -join ';'

$previousCodexBin = $env:CODEX_BIN
$previousPath = $env:Path
try {
    Remove-Item Env:CODEX_BIN -ErrorAction SilentlyContinue
    $env:Path = $restrictedPath
    $output = & $nodePath (Join-Path $projectDirectory 'src\status.js') 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        throw "Manual status entry failed in an Explorer-like environment: $($output.Trim())"
    }
    if ($output -match 'spawn codex\.exe ENOENT') {
        throw 'Manual status entry could not locate the Codex App Server.'
    }
    if ($output -notmatch 'Tibo Radar') {
        throw "Manual status entry did not print quota status: $($output.Trim())"
    }
}
finally {
    $env:Path = $previousPath
    if ($null -eq $previousCodexBin) {
        Remove-Item Env:CODEX_BIN -ErrorAction SilentlyContinue
    }
    else {
        $env:CODEX_BIN = $previousCodexBin
    }
}

Write-Output 'PASS: manual status entry resolves Codex without relying on the inherited PATH.'
