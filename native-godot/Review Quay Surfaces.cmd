@echo off
pwsh -NoProfile -File "%~dp0scripts\open-native-game.ps1" -ReviewSurfaces %*
if errorlevel 1 pause
