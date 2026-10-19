param([string]$Blender)
# Build the cathedral furniture (art-source/tools/blender/build_church.py): the cathedral's confessional, pulpit and side altars' fittings (#198),
# into .scratch/church-plain/church.glb with
# check pictures in .scratch/church-build/shots. Then store them with replace-church.ps1.
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if (-not $Blender) { $Blender = Join-Path $env:ProgramFiles 'Blender Foundation/Blender 5.2/blender.exe' }
if (-not (Test-Path -LiteralPath $Blender)) { throw 'Pass -Blender with the installed Blender executable.' }
$output = Join-Path $workspace '.scratch/church-plain/church.glb'
$shots = Join-Path $workspace '.scratch/church-build/shots'
[void](New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($output)), $shots)
$start = [Diagnostics.ProcessStartInfo]::new($Blender)
$start.WorkingDirectory = $workspace; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
foreach ($arg in @('-b','--factory-startup','--disable-autoexec','--python-exit-code','1','-P','art-source/tools/blender/build_church.py','--','--out',$output,'--shots',$shots)) { $start.ArgumentList.Add($arg) }
$child = [Diagnostics.Process]::new(); $child.StartInfo = $start
try {
    [void]$child.Start(); $stdout = $child.StandardOutput.ReadToEndAsync(); $stderr = $child.StandardError.ReadToEndAsync()
    if (-not $child.WaitForExit(900000)) { $child.Kill($true); $child.WaitForExit(); throw 'The church build exceeded fifteen minutes.' }
    $log = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()
    [IO.File]::WriteAllText((Join-Path $workspace '.scratch/church-build.log'), $log)
    if ($child.ExitCode -ne 0 -or $log -match 'Traceback' -or $log -notmatch 'CHURCH BUILD COMPLETE') { throw 'The church build failed; inspect .scratch/church-build.log.' }
} finally {
    if ($child.Id -and -not $child.HasExited) { $child.Kill($true); $child.WaitForExit() }
    $child.Dispose()
}
Write-Output "Fittings built: $output"
