param([string]$Blender)
# Build the small goods (art-source/tools/blender/build_smallgoods.py, #180): the fish market's cod and plaice and the
# emigrant mothers' swaddled baby, into .scratch/smallgoods-plain/smallgoods.glb with
# check pictures in .scratch/smallgoods-build/shots. Then store them with replace-smallgoods.ps1.
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if (-not $Blender) { $Blender = Join-Path $env:ProgramFiles 'Blender Foundation/Blender 5.2/blender.exe' }
if (-not (Test-Path -LiteralPath $Blender)) { throw 'Pass -Blender with the installed Blender executable.' }
$output = Join-Path $workspace '.scratch/smallgoods-plain/smallgoods.glb'
$shots = Join-Path $workspace '.scratch/smallgoods-build/shots'
[void](New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($output)), $shots)
$start = [Diagnostics.ProcessStartInfo]::new($Blender)
$start.WorkingDirectory = $workspace; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
foreach ($arg in @('-b','--factory-startup','--disable-autoexec','--python-exit-code','1','-P','art-source/tools/blender/build_smallgoods.py','--','--out',$output,'--shots',$shots)) { $start.ArgumentList.Add($arg) }
$child = [Diagnostics.Process]::new(); $child.StartInfo = $start
try {
    [void]$child.Start(); $stdout = $child.StandardOutput.ReadToEndAsync(); $stderr = $child.StandardError.ReadToEndAsync()
    if (-not $child.WaitForExit(900000)) { $child.Kill($true); $child.WaitForExit(); throw 'The small goods build exceeded fifteen minutes.' }
    $log = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()
    [IO.File]::WriteAllText((Join-Path $workspace '.scratch/smallgoods-build.log'), $log)
    if ($child.ExitCode -ne 0 -or $log -match 'Traceback' -or $log -notmatch 'SMALLGOODS BUILD COMPLETE') { throw 'The small goods build failed; inspect .scratch/smallgoods-build.log.' }
} finally {
    if ($child.Id -and -not $child.HasExited) { $child.Kill($true); $child.WaitForExit() }
    $child.Dispose()
}
Write-Output "Small goods built: $output"
