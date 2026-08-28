@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\configure-serverchan.ps1"
if errorlevel 1 (
  echo.
  echo Configuration did not complete. Review the redacted error above and retry.
)
pause
