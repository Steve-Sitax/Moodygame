@echo off
where pwsh >nul 2>nul && (set "PS=pwsh") || (set "PS=%ProgramFiles%\PowerShell\7\pwsh.exe")
"%PS%" -NoProfile -File "%~dp0scripts\open-native-server.ps1" %*
if errorlevel 1 pause
