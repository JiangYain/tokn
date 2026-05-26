@echo off
setlocal
cd /d "%~dp0"

if not exist "%~dp0node_modules\electron\dist\electron.exe" (
  echo Electron runtime not found. Run npm install first.
  exit /b 1
)

start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
