@echo off
pwsh -NoProfile -File "%~dp0scripts\open-workshop.ps1" -District rijnkaai-recovered
if errorlevel 1 pause
