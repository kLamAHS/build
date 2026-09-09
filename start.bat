@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Keepwright needs Node.js 22.13 or later. Install the current LTS from https://nodejs.org
  pause
  exit /b 1
)
node scripts/start-local.mjs
if errorlevel 1 pause
