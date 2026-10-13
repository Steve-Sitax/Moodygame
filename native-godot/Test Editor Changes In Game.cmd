@echo off
where pwsh >nul 2>nul && (set "PS=pwsh") || (set "PS=%ProgramFiles%\PowerShell\7\pwsh.exe")
"%PS%" -NoProfile -File "%~dp0scripts\run-icon.ps1" open-native-town.ps1 -SceneSeed %*
if errorlevel 1 pause
