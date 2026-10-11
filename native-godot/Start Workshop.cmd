@echo off
pwsh -NoProfile -File "%~dp0scripts\open-workshop.ps1" %*
if errorlevel 1 pause
