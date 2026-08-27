param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$Message
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$notification = New-Object System.Windows.Forms.NotifyIcon
try {
    $notification.Icon = [System.Drawing.SystemIcons]::Information
    $notification.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $notification.BalloonTipTitle = $Title.Substring(0, [Math]::Min($Title.Length, 63))
    $notification.BalloonTipText = $Message.Substring(0, [Math]::Min($Message.Length, 255))
    $notification.Text = 'Tibo Radar'
    $notification.Visible = $true
    $notification.ShowBalloonTip(8000)
    Start-Sleep -Seconds 8
}
finally {
    $notification.Dispose()
}
