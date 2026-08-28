param(
    [string]$Repository = 'root1739126979/tibo-radar'
)

$ErrorActionPreference = 'Stop'
if ($Repository -ne 'root1739126979/tibo-radar') {
    throw 'Repository is fixed to root1739126979/tibo-radar.'
}
$projectDirectory = Split-Path -Parent $PSScriptRoot
$secretPath = Join-Path $projectDirectory 'data\serverchan-sendkey.dpapi'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$GhPath = (Get-Command gh.exe -ErrorAction Stop).Source
$secureKey = Read-Host '请粘贴 sctp... SendKey（输入不会显示）' -AsSecureString
$bstr = [IntPtr]::Zero
$SendKey = $null
$plainBytes = $null
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

    & $GhPath auth status --hostname github.com 1>$null
    if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI 尚未登录。' }
    $SendKey | & $GhPath secret set SERVERCHAN_SENDKEY --repo $Repository
    if ($LASTEXITCODE -ne 0) { throw 'GitHub Secret 写入失败。' }

    $requestId = [Guid]::NewGuid().ToString('N')
    & $GhPath workflow run tibo-monitor.yml --repo $Repository -f mode=serverchan-smoke-test -f "request_id=$requestId"
    if ($LASTEXITCODE -ne 0) { throw '[云端测试] 工作流触发失败。' }
    $runDeadline = (Get-Date).AddMinutes(2)
    $expectedRunName = "Tibo reset monitor / serverchan-smoke-test / $requestId"
    $run = $null
    do {
        $runsJson = & $GhPath run list --repo $Repository --workflow tibo-monitor.yml --event workflow_dispatch --json databaseId,displayTitle,url --limit 20
        if ($LASTEXITCODE -ne 0) { throw '[云端测试] 工作流查询失败。' }
        $runs = $runsJson | ConvertFrom-Json
        $run = @($runs) | Where-Object { $_.displayTitle -eq $expectedRunName } | Select-Object -First 1
        if ($run) { break }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $runDeadline)
    if (-not $run) { throw '[云端测试] 无法定位对应的工作流运行。' }
    & $GhPath run watch $run.databaseId --repo $Repository --exit-status
    if ($LASTEXITCODE -ne 0) { throw '[云端测试] 发送失败。' }

    & $GhPath api --method PUT "repos/$Repository/actions/permissions/artifact-and-log-retention" -F days=30 1>$null
    if ($LASTEXITCODE -ne 0) { throw 'GitHub Actions 日志保留期配置失败。' }

    $enabledAt = [DateTime]::UtcNow.ToString('o')
    & $GhPath variable set SERVERCHAN_ENABLED_AT --repo $Repository --body $enabledAt
    if ($LASTEXITCODE -ne 0) { throw '启用时间水位写入失败。' }
    Write-Output 'Server酱³ App 通知配置完成。'
    Write-Output "云端测试：$($run.url)"
}
finally {
    if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    $SendKey = $null
    $secureKey = $null
}
