@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Please install Node.js 20 or newer, then run this file again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found.
  echo Please install Node.js 20 or newer, then run this file again.
  pause
  exit /b 1
)

set "PICOEDIT_URL=http://127.0.0.1:8765/"

echo Starting PicoEdit...
start "PicoEdit Server" /min node server.js

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wait-health.ps1" "%PICOEDIT_URL%api/health" 20 >nul 2>nul
if not errorlevel 1 (
  start "" "%PICOEDIT_URL%"
  echo PicoEdit is ready.
  exit /b 0
)

echo PicoEdit could not start.
echo Close any old PicoEdit server window, then run this file again.
pause
