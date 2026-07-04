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

start "" "http://127.0.0.1:8765/"
npm start

pause
