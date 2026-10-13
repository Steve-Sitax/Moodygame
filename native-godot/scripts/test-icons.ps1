param(
    [string]$IconFolder = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Scheldemist'),
    [switch]$Full,
    [int]$StartSeconds = 240
)
# Proves the desktop icons start. Without -Full each icon's launcher is run with a stripped PATH (what Explorer gives it) up to
# the PowerShell call, and its target script must exist. With -Full the Play icon is also run for real in an isolated data
# folder: the game window must open; only the processes this test started are stopped. Plain ASCII on purpose.
$ErrorActionPreference = 'Stop'
$results = [Collections.Generic.List[object]]::new()
function Add-Result([string]$Icon, [bool]$Ok, [string]$Detail) { $results.Add([pscustomobject]@{ Icon = $Icon; Result = $(if ($Ok) { 'PASS' } else { 'FAIL' }); Detail = $Detail }) }
$shell = New-Object -ComObject WScript.Shell
$icons = Get-ChildItem -LiteralPath $IconFolder -Filter *.lnk
if (-not $icons) { throw "No icons in $IconFolder" }
# What the desktop can hand an icon: (a) the machine and user PATH as stored, which holds a broken entry (a stray quote after the
# PowerShell 7 folder) that makes 'where pwsh' succeed while running pwsh fails; (b) a bare PATH with no PowerShell 7 at all.
$registryPath = [Environment]::ExpandEnvironmentVariables([Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH', 'User'))
$pathCases = [ordered]@{ 'registry PATH' = $registryPath; 'bare PATH' = ((Join-Path $env:SystemRoot 'System32') + ';' + (Join-Path $env:ProgramFiles 'PowerShell\7') + '"') }
$strippedPath = $pathCases['bare PATH']
foreach ($icon in $icons) {
    $link = $shell.CreateShortcut($icon.FullName); $target = $link.TargetPath
    if (-not (Test-Path -LiteralPath $target)) { Add-Result $icon.BaseName $false "target missing: $target"; continue }
    if ([IO.Path]::GetExtension($target) -ne '.cmd') { Add-Result $icon.BaseName $true "starts $target directly"; continue }
    $lines = Get-Content -LiteralPath $target
    $launch = $lines | Where-Object { $_ -match '-File\s+"[^"]+"\s+(\S+\.ps1)' } | Select-Object -First 1
    $script = if ($launch -match 'run-icon\.ps1"\s+(\S+\.ps1)') { $Matches[1] } elseif ($launch -match 'scripts\\(\S+\.ps1)') { $Matches[1] } else { $null }
    if (-not $script) { Add-Result $icon.BaseName $false 'no launcher script found in the .cmd'; continue }
    $scriptPath = Join-Path (Split-Path $target) "scripts\$script"
    if (-not (Test-Path -LiteralPath $scriptPath)) { Add-Result $icon.BaseName $false "script missing: $scriptPath"; continue }
    $probe = Join-Path ([IO.Path]::GetTempPath()) ('icon-probe-' + [guid]::NewGuid().ToString('N') + '.cmd')
    $body = foreach ($line in $lines) { if ($line -eq $launch) { $line -replace '-File\s+"[^"]+"\s+\S+\.ps1.*$', '-Command "Write-Output icon-probe-ok"' } else { $line } }
    Set-Content -LiteralPath $probe -Value ($body | Where-Object { $_ -notmatch '^if errorlevel' }) -Encoding ascii
    foreach ($case in $pathCases.Keys) {
        $saved = $env:PATH; $env:PATH = $pathCases[$case]
        try { $output = (& cmd /c "`"$probe`" 2>&1") -join ' ' } finally { $env:PATH = $saved }
        Add-Result "$($icon.BaseName) ($case)" ($output -match 'icon-probe-ok') $(if ($output -match 'icon-probe-ok') { "launcher runs PowerShell, then $script" } else { "launcher output: $output" })
    }
    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
}
if ($Full) {
    $play = $icons | Where-Object { $_.BaseName -like 'Play*' } | Select-Object -First 1
    if (-not $play) { Add-Result 'Play (full run)' $false 'no Play icon'; }
    else {
        $target = $shell.CreateShortcut($play.FullName).TargetPath
        $data = Join-Path $env:TEMP ('icon-full-' + [guid]::NewGuid().ToString('N')); [void](New-Item -ItemType Directory -Path $data)
        $saved = $env:PATH; $env:PATH = $strippedPath; $started = $null; $cmdProcess = $null
        try {
            $cmdProcess = Start-Process cmd -ArgumentList '/c', "`"`"$target`" -DataDirectory `"$data`"`"" -WorkingDirectory (Split-Path $target) -PassThru -WindowStyle Hidden
            $deadline = (Get-Date).AddSeconds($StartSeconds)
            while ((Get-Date) -lt $deadline -and -not $started -and -not $cmdProcess.HasExited) {
                Start-Sleep 4
                $mine = Get-CimInstance Win32_Process -Filter "Name like 'Godot%'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($data) }
                foreach ($process in $mine) { if ((Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue).MainWindowTitle -like 'Scheldemist*') { $started = $process } }
            }
            Add-Result 'Play (full run)' ([bool]$started) $(if ($started) { 'game window opened' } else { "no game window within $StartSeconds s; launcher exited: $($cmdProcess.HasExited); see %LOCALAPPDATA%\ScheldemistWorkshop\launch-logs" })
        } finally {
            $env:PATH = $saved
            Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($data) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
            if ($cmdProcess -and -not $cmdProcess.HasExited) { Stop-Process -Id $cmdProcess.Id -Force -ErrorAction SilentlyContinue }
            Start-Sleep 3; Remove-Item -LiteralPath $data -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
$results | Format-Table -AutoSize -Wrap | Out-String | Write-Output
if ($results | Where-Object Result -eq 'FAIL') { exit 1 }
