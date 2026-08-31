$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $projectDirectory 'scripts\configure-serverchan.ps1'
$source = Get-Content -Raw -LiteralPath $scriptPath

$assemblyLoadPosition = $source.IndexOf('Add-Type -AssemblyName System.Security')
$protectPosition = $source.IndexOf('[Security.Cryptography.ProtectedData]::Protect')
if ($assemblyLoadPosition -lt 0 -or $protectPosition -lt 0 -or $assemblyLoadPosition -gt $protectPosition) {
    throw 'Windows PowerShell must load System.Security before resolving ProtectedData.'
}

if ($source -notmatch [regex]::Escape("`$WorkerUrl = 'https://tibo-radar.sdcz900828.workers.dev'")) {
    throw 'Configuration does not pin the intended Cloudflare Worker.'
}
if ($source -notmatch '(?s)\$SendKey\s*\|\s*&\s*\$nodePath\s+\$secretWriter\s+SERVERCHAN_SENDKEY') {
    throw 'Cloudflare Secret is not written over standard input.'
}
if ($source -match '(?i)(?:--body|-b)\s+\$SendKey') {
    throw 'SendKey is exposed as a command-line argument.'
}
if ($source -notmatch '(?s)\$AdminToken\s*\|\s*&\s*\$nodePath\s+\$secretWriter\s+ADMIN_TOKEN') {
    throw 'Cloudflare smoke token is not written over standard input.'
}
if ($source -notmatch [regex]::Escape("Authorization = 'Bearer ' + `$AdminToken")) {
    throw 'Cloud smoke test does not authenticate with the generated token.'
}
if ($source -notmatch "Invoke-RestMethod.*\$WorkerUrl/__smoke") {
    throw 'Cloud smoke test does not target the fixed Worker endpoint.'
}
$localPosition = $source.IndexOf('[本机测试]')
$cloudPosition = $source.IndexOf('/__smoke')
if ($localPosition -lt 0 -or $cloudPosition -lt 0 -or $cloudPosition -lt $localPosition) {
    throw 'The local test must complete before the Cloudflare smoke test.'
}
if ($source -match '(?i)\bgh(?:\.exe)?\b|GITHUB_TOKEN|SERVERCHAN_ENABLED_AT') {
    throw 'Legacy GitHub Actions configuration remains in the Cloudflare setup.'
}
if ($source -match 'sctp[0-9]+t[A-Za-z0-9_-]{6,}') {
    throw 'Configuration script contains a SendKey-shaped literal.'
}

Write-Output 'PASS: ServerChan configuration keeps secrets off argv and pins the Cloudflare target.'
