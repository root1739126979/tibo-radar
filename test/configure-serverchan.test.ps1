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
$localPosition = $source.IndexOf('[本机测试]')
$cloudPosition = $source.IndexOf('serverchan-smoke-test')
$enabledPosition = $source.IndexOf('SERVERCHAN_ENABLED_AT')
if ($localPosition -lt 0 -or $cloudPosition -lt 0 -or $enabledPosition -lt 0) {
    throw 'Both smoke tests and the enable watermark are required.'
}
if ($enabledPosition -lt $localPosition -or $enabledPosition -lt $cloudPosition) {
    throw 'Enable watermark must be written only after both smoke tests.'
}
if ($source -match 'sctp[0-9]+t[A-Za-z0-9_-]{6,}') {
    throw 'Configuration script contains a SendKey-shaped literal.'
}

Write-Output 'PASS: ServerChan configuration keeps the key off argv and pins the cloud target.'
