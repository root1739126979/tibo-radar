$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$dataDirectory = Join-Path $projectDirectory 'data'
$errorsPath = Join-Path $dataDirectory 'errors.log'
$outboxPath = Join-Path $dataDirectory 'notification-outbox.json'

Remove-Item -LiteralPath $errorsPath -Force -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $outboxPath -PathType Leaf) {
    $outbox = Get-Content -Raw -LiteralPath $outboxPath | ConvertFrom-Json
    $outbox.items = @($outbox.items | Where-Object { $_.status -ne 'sent' })
    $temporaryPath = "$outboxPath.$PID.tmp"
    $json = $outbox | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText($temporaryPath, "$json`n", [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporaryPath -Destination $outboxPath -Force
}
Write-Output '已清除本机错误日志和已发送通知记录；配额历史、重置事件、待发送通知和 App 密钥均已保留。'
