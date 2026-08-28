$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $projectDirectory 'scripts\configure-serverchan.ps1'
$source = Get-Content -Raw -LiteralPath $scriptPath

if ($source -notmatch [regex]::Escape("`$Repository = 'root1739126979/tibo-radar'")) {
    throw 'Configuration does not pin the intended GitHub repository.'
}
if ($source -notmatch '(?s)\$SendKey\s*\|\s*&\s*\$GhPath\s+secret\s+set\s+SERVERCHAN_SENDKEY') {
    throw 'GitHub Secret is not written over standard input.'
}
if ($source -match '(?i)(?:--body|-b)\s+\$SendKey') {
    throw 'SendKey is exposed as a command-line argument.'
}
if ($source -match 'Start-Sleep\s+-Seconds\s+3') {
    throw 'Cloud run discovery still relies on a fixed three-second sleep.'
}
if ($source -notmatch '(?s)\$runDeadline\s*=.*AddMinutes\(2\).*do\s*\{.*Start-Sleep\s+-Seconds\s+2.*\}\s*while.*\$runDeadline') {
    throw 'Cloud run discovery must use bounded polling with an explicit interval.'
}
if ($source -notmatch '\$_.displayTitle\s+-eq\s+\$expectedRunName') {
    throw 'Cloud run discovery does not match the exact request-id run name.'
}
$localPosition = $source.IndexOf('[本机测试]')
$cloudPosition = $source.IndexOf('serverchan-smoke-test')
$enabledPosition = $source.IndexOf('SERVERCHAN_ENABLED_AT')
$retentionPosition = $source.IndexOf('artifact-and-log-retention')
if ($localPosition -lt 0 -or $cloudPosition -lt 0 -or $retentionPosition -lt 0 -or $enabledPosition -lt 0) {
    throw 'Both smoke tests and the enable watermark are required.'
}
if ($enabledPosition -lt $localPosition -or $enabledPosition -lt $cloudPosition -or $enabledPosition -lt $retentionPosition) {
    throw 'Enable watermark must be written only after both smoke tests.'
}
if ($source -match 'sctp[0-9]+t[A-Za-z0-9_-]{6,}') {
    throw 'Configuration script contains a SendKey-shaped literal.'
}

Write-Output 'PASS: ServerChan configuration keeps the key off argv and pins the cloud target.'
