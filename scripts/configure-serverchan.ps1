param(
    [string]$WorkerUrl = 'https://tibo-radar.sdcz900828.workers.dev'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
if ($WorkerUrl -ne 'https://tibo-radar.sdcz900828.workers.dev') {
    throw 'Worker URL is fixed to the deployed Tibo Radar service.'
}
$projectDirectory = Split-Path -Parent $PSScriptRoot
$secretPath = Join-Path $projectDirectory 'data\serverchan-sendkey.dpapi'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$secretWriter = Join-Path $projectDirectory 'scripts\set-cloudflare-secret.js'
$secureKey = Read-Host '请粘贴 sctp... SendKey（输入不会显示）' -AsSecureString
$bstr = [IntPtr]::Zero
$SendKey = $null
$plainBytes = $null
$AdminToken = $null
$adminBytes = $null
$rng = $null
try {
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    $SendKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    if ($SendKey -notmatch '^sctp[1-9][0-9]{0,19}t[A-Za-z0-9_-]{6,256}$') {
        throw 'SendKey 格式无效；Server酱³ App 密钥应以 sctp 开头。'
    }

    $plainBytes = [Text.Encoding]::UTF8.GetBytes($SendKey)
    $entropy = [Text.Encoding]::UTF8.GetBytes('tibo-radar-serverchan-v1')
    $encrypted = [Security.Cryptography.ProtectedData]::Protect(
        $plainBytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $dataDirectory = Split-Path -Parent $secretPath
    [IO.Directory]::CreateDirectory($dataDirectory) | Out-Null
    $temporaryPath = "$secretPath.$PID.tmp"
    [IO.File]::WriteAllBytes($temporaryPath, $encrypted)
    Move-Item -LiteralPath $temporaryPath -Destination $secretPath -Force

    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetOwner([Security.Principal.NTAccount]::new($identity))
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
        $identity, [Security.AccessControl.FileSystemRights]::FullControl,
        [Security.AccessControl.AccessControlType]::Allow
    ))
    Set-Acl -LiteralPath $secretPath -AclObject $acl

    & $nodePath (Join-Path $projectDirectory 'src\local-serverchan.js') --smoke-test
    if ($LASTEXITCODE -ne 0) { throw '[本机测试] 发送失败。' }

    $SendKey | & $nodePath $secretWriter SERVERCHAN_SENDKEY 1>$null
    if ($LASTEXITCODE -ne 0) { throw 'Cloudflare ServerChan Secret 写入失败。' }

    $adminBytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($adminBytes)
    $AdminToken = [Convert]::ToBase64String($adminBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    $AdminToken | & $nodePath $secretWriter ADMIN_TOKEN 1>$null
    if ($LASTEXITCODE -ne 0) { throw 'Cloudflare smoke token 写入失败。' }

    $headers = @{ Authorization = 'Bearer ' + $AdminToken }
    $cloudResult = Invoke-RestMethod -Method Post -Uri "$WorkerUrl/__smoke" -Headers $headers -TimeoutSec 30
    if ($cloudResult.ok -ne $true) { throw '[云端测试] 发送失败。' }

    Write-Output 'Server酱³ App 通知配置完成。'
    Write-Output "云端监控：$WorkerUrl/health"
}
finally {
    if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
    if ($adminBytes) { [Array]::Clear($adminBytes, 0, $adminBytes.Length) }
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ($rng) { $rng.Dispose() }
    $SendKey = $null
    $AdminToken = $null
    $headers = $null
    $cloudResult = $null
    $secureKey = $null
}
