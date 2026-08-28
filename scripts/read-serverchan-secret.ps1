param(
    [Parameter(Mandatory = $true)][string]$SecretPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$resolved = [System.IO.Path]::GetFullPath($SecretPath)
$projectDirectory = Split-Path -Parent $PSScriptRoot
$expected = [System.IO.Path]::GetFullPath((Join-Path $projectDirectory 'data\serverchan-sendkey.dpapi'))
if (-not [string]::Equals($resolved, $expected, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'SecretPath must be the fixed Tibo Radar secret file.'
}
$encrypted = [System.IO.File]::ReadAllBytes($resolved)
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $encrypted,
    [System.Text.Encoding]::UTF8.GetBytes('tibo-radar-serverchan-v1'),
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
try {
    [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plain))
}
finally {
    [Array]::Clear($plain, 0, $plain.Length)
}
