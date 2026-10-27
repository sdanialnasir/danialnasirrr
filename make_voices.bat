@echo off
rem Aqua Energizer voice-overs. Works from the extracted zip (all files in one folder) or from the game project (tools folder).
cd /d "%~dp0"
set "PS1=%~dp0make_voices.ps1"
if not exist "%PS1%" set "PS1=%~dp0tools\make_voices.ps1"
if not exist "%PS1%" (
  echo Could not find make_voices.ps1. Keep it in the same folder as this .bat file.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
pause
