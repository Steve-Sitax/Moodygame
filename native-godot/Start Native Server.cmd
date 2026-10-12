@echo off
pwsh -NoProfile -File "%~dp0scripts\open-native-server.ps1" %*
if errorlevel 1 pause
