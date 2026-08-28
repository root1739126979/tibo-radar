@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\configure-serverchan.ps1"
if errorlevel 1 (
  echo.
  echo 配置没有完成，请根据上面的脱敏错误排查后重试。
)
pause
