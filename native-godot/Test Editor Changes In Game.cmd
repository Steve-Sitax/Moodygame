@echo off
pwsh -NoProfile -File "%~dp0scripts\open-native-town.ps1" -SceneSeed %*
if errorlevel 1 pause
