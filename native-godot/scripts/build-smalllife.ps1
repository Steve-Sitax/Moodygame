param([string]$Blender)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if (-not $Blender) { $Blender = Join-Path $env:ProgramFiles 'Blender Foundation/Blender 5.2/blender.exe' }
if (-not (Test-Path -LiteralPath $Blender)) { throw 'Pass -Blender with the installed Blender executable.' }
$output = Join-Path $workspace '.scratch/smalllife-plain/smalllife.glb'
[void](New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($output)))
$start = [Diagnostics.ProcessStartInfo]::new($Blender)
$start.WorkingDirectory = $workspace; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
$start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
$start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
foreach ($arg in @('-b','--factory-startup','--disable-autoexec','--python-exit-code','1','-P','art-source/tools/blender/build_smalllife.py','--','--plain',$output)) { $start.ArgumentList.Add($arg) }
$child = [Diagnostics.Process]::new(); $child.StartInfo = $start
try {
    [void]$child.Start(); $stdout = $child.StandardOutput.ReadToEndAsync(); $stderr = $child.StandardError.ReadToEndAsync()
    if (-not $child.WaitForExit(600000)) { $child.Kill($true); $child.WaitForExit(); throw 'Small-life build exceeded ten minutes.' }
    $log = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()
    [IO.File]::WriteAllText((Join-Path $workspace '.scratch/smalllife-build.log'),$log)
    if ($child.ExitCode -ne 0 -or $log -match 'Traceback' -or $log -notmatch 'SMALLLIFE BUILD COMPLETE 16') { throw 'Small-life build failed; inspect .scratch/smalllife-build.log.' }
    & python (Join-Path $workspace 'art-source/tools/blender/smalllife/check_export.py')
    if ($LASTEXITCODE) { throw 'Small-life exported-data checks failed.' }
} finally {
    if ($child.Id -and -not $child.HasExited) { $child.Kill($true); $child.WaitForExit() }
    $child.Dispose()
}
