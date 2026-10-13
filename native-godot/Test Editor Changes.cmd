@echo off
where pwsh >nul 2>nul && (set "PS=pwsh") || (set "PS=%ProgramFiles%\PowerShell\7\pwsh.exe")
"%PS%" -NoProfile -File "%~dp0scripts\run-icon.ps1" open-workshop.ps1 -District rijnkaai-recovered -Fresh
if errorlevel 1 pause
