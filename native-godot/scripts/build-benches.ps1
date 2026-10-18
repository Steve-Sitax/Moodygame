param([string]$Blender)
# Build the street benches (art-source/tools/blender/build_benches.py, #165): the cast-iron park bench and the plank
# bench, each fine and worn, into .scratch/benches-plain/benches.glb with check pictures in .scratch/benches-build/shots.
# Then store them with replace-benches.ps1.
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if (-not $Blender) { $Blender = Join-Path $env:ProgramFiles 'Blender Foundation/Blender 5.2/blender.exe' }
if (-not (Test-Path -LiteralPath $Blender)) { throw 'Pass -Blender with the installed Blender executable.' }
$output = Join-Path $workspace '.scratch/benches-plain/benches.glb'
$shots = Join-Path $workspace '.scratch/benches-build/shots'
[void](New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($output)), $shots)
$start = [Diagnostics.ProcessStartInfo]::new($Blender)
$start.WorkingDirectory = $workspace; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
foreach ($arg in @('-b','--factory-startup','--disable-autoexec','--python-exit-code','1','-P','art-source/tools/blender/build_benches.py','--','--out',$output,'--shots',$shots)) { $start.ArgumentList.Add($arg) }
$child = [Diagnostics.Process]::new(); $child.StartInfo = $start
try {
    [void]$child.Start(); $stdout = $child.StandardOutput.ReadToEndAsync(); $stderr = $child.StandardError.ReadToEndAsync()
    if (-not $child.WaitForExit(900000)) { $child.Kill($true); $child.WaitForExit(); throw 'The benches build exceeded fifteen minutes.' }
    $log = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()
    [IO.File]::WriteAllText((Join-Path $workspace '.scratch/benches-build.log'), $log)
    if ($child.ExitCode -ne 0 -or $log -match 'Traceback' -or $log -notmatch 'BENCHES BUILD COMPLETE') { throw 'The benches build failed; inspect .scratch/benches-build.log.' }
} finally {
    if ($child.Id -and -not $child.HasExited) { $child.Kill($true); $child.WaitForExit() }
    $child.Dispose()
}
Write-Output "Benches built: $output"
