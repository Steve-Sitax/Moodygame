@echo off
set "PS="
for %%P in ("%ProgramW6432%\PowerShell\7\pwsh.exe" "%ProgramFiles%\PowerShell\7\pwsh.exe" "%LOCALAPPDATA%\Microsoft\WinGet\Links\pwsh.exe") do if not defined PS if exist %%P set "PS=%%~P"
if not defined PS set "PS=pwsh"
"%PS%" -NoProfile -File "%~dp0scripts\run-icon.ps1" open-native-game.ps1 -ReviewSurfaces %*
if errorlevel 1 pause
