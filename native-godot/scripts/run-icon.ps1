param(
    [Parameter(Mandatory)][string]$Target,
    [Parameter(ValueFromRemainingArguments)][string[]]$Rest
)
# Runs one launcher script for a desktop icon. Everything it prints goes to a log file as well, so a failure is never lost
# when the console window closes: %LOCALAPPDATA%\ScheldemistWorkshop\launch-logs. Plain ASCII on purpose.
$ErrorActionPreference = 'Continue'
# An icon starts with the PATH the desktop had at sign-in, so tools installed since (pwsh, dotnet, git) can be missing.
# Rebuild PATH from the machine and user settings, plus the usual install folders, and drop broken entries.
$pathParts = @([Environment]::GetEnvironmentVariable('PATH', 'Machine'), [Environment]::GetEnvironmentVariable('PATH', 'User'), $env:PATH,
    (Join-Path $env:ProgramFiles 'PowerShell\7'), (Join-Path $env:ProgramFiles 'dotnet'), (Join-Path $env:ProgramFiles 'Git\cmd'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links')) | ForEach-Object { if ($_) { $_ -split ';' } }
$seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$env:PATH = (($pathParts | ForEach-Object { [Environment]::ExpandEnvironmentVariables($_.Trim()) } | Where-Object { $_ -and $_ -notmatch '"' -and $seen.Add($_.TrimEnd('\')) }) -join ';')
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$logDirectory = Join-Path $env:LOCALAPPDATA 'ScheldemistWorkshop\launch-logs'
[void](New-Item -ItemType Directory -Path $logDirectory -Force)
$log = Join-Path $logDirectory ('{0}-{1:yyyyMMdd-HHmmss}.log' -f [IO.Path]::GetFileNameWithoutExtension($Target), (Get-Date))
Get-ChildItem -LiteralPath $logDirectory -Filter *.log | Sort-Object LastWriteTime -Descending | Select-Object -Skip 20 | Remove-Item -Force -ErrorAction SilentlyContinue
function Say([string]$Text) { Write-Host $Text; Add-Content -LiteralPath $log -Value $Text }
Say ('Launcher {0} at {1:yyyy-MM-dd HH:mm:ss}, project {2}' -f $Target, (Get-Date), $project)
$running = @(Get-CimInstance Win32_Process -Filter "Name like 'Godot%'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($project) })
if ($running.Count -gt 0) { Say ('Note: {0} Godot process(es) already run from this folder (pid {1}). A build can fail while they hold the game files.' -f $running.Count, (($running | ForEach-Object ProcessId) -join ', ')) }
$engine = (Get-Process -Id $PID).Path
& $engine -NoProfile -File (Join-Path $PSScriptRoot $Target) @Rest 2>&1 | Tee-Object -FilePath $log -Append
$code = $LASTEXITCODE
if ($code -ne 0) {
    $text = Get-Content -LiteralPath $log -Raw -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host ('THE GAME DID NOT START OR STOPPED WITH AN ERROR (exit code {0}).' -f $code) -ForegroundColor Red
    if ($text -match 'being used by another process|MSB3027|MSB3021') { Write-Host 'A game window or build from this folder is still running. Close it and try again.' -ForegroundColor Yellow }
    elseif ($text -match 'Build failed|error CS\d+') { Write-Host 'The build failed. The lines above say why.' -ForegroundColor Yellow }
    Write-Host ('Full log: {0}' -f $log)
}
exit $code
