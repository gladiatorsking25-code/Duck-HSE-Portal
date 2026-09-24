@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 22 or newer from https://nodejs.org/
  echo Then double-click this file again.
  pause
  exit /b 1
)
node server\launch.mjs
pause
