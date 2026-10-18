param([string]$Blender)
# Build the hiring board (art-source/tools/blender/build_workboard.py, #153) into .scratch/workboard-plain/workboard.glb
# with check pictures in .scratch/workboard-build/shots. Then store it with replace-workboard.ps1.
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if (-not $Blender) { $Blender = Join-Path $env:ProgramFiles 'Blender Foundation/Blender 5.2/blender.exe' }
if (-not (Test-Path -LiteralPath $Blender)) { throw 'Pass -Blender with the installed Blender executable.' }
$output = Join-Path $workspace '.scratch/workboard-plain/workboard.glb'
$shots = Join-Path $workspace '.scratch/workboard-build/shots'
[void](New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($output)), $shots)
$start = [Diagnostics.ProcessStartInfo]::new($Blender)
$start.WorkingDirectory = $workspace; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
foreach ($arg in @('-b','--factory-startup','--disable-autoexec','--python-exit-code','1','-P','art-source/tools/blender/build_workboard.py','--','--out',$output,'--shots',$shots)) { $start.ArgumentList.Add($arg) }
$child = [Diagnostics.Process]::new(); $child.StartInfo = $start
try {
    [void]$child.Start(); $stdout = $child.StandardOutput.ReadToEndAsync(); $stderr = $child.StandardError.ReadToEndAsync()
    if (-not $child.WaitForExit(900000)) { $child.Kill($true); $child.WaitForExit(); throw 'The work board build exceeded fifteen minutes.' }
    $log = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()
    [IO.File]::WriteAllText((Join-Path $workspace '.scratch/workboard-build.log'), $log)
    if ($child.ExitCode -ne 0 -or $log -match 'Traceback' -or $log -notmatch 'WORKBOARD BUILD COMPLETE') { throw 'The work board build failed; inspect .scratch/workboard-build.log.' }
} finally {
    if ($child.Id -and -not $child.HasExited) { $child.Kill($true); $child.WaitForExit() }
    $child.Dispose()
}
Write-Output "Work board built: $output"
