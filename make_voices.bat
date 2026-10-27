@echo off
rem Aqua Energizer: make the ElevenLabs voice-overs (see tools\make_voices.ps1 and tools\voices.json)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\make_voices.ps1" %*
pause
