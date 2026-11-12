param([Parameter(Mandatory)][string]$Package, [string]$Work, [int]$Port = 18831, [int]$LimitMinutes = 90, [switch]$VerifyOnly)
# Puts the prepared start-up geometry (the startup caches) into an exported client package, so a player's first
# start does not build it. Run after export-native-windows.ps1 and before the package checks and the upload.
#   1. Starts the package once with an empty cache folder inside the package: the game builds every entry there.
#   2. Names that folder startup-cache: the game reads it as the package's own read-only cache.
#   3. Starts the package again with empty user data: it must reach play without building a single entry.
# Plain ASCII on purpose. Save data and layouts stay in the work folder; none of it enters the package.
$ErrorActionPreference = 'Stop'
$Package = [IO.Path]::GetFullPath($Package)
$exe = Join-Path $Package 'Scheldemist.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "No exported client in $Package" }
if (-not $Work) { $Work = Join-Path ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))) '.scratch/seed-startup-cache' }
$Work = [IO.Path]::GetFullPath($Work)
$seed = Join-Path $Package 'startup-cache'
$building = Join-Path $Package 'startup-cache.building'

function Start-Package([string]$Name, [hashtable]$Environment) {
    $data = Join-Path $Work "$Name-userdata"; $layouts = Join-Path $Work "$Name-layouts"
    foreach ($folder in @($data, $layouts)) {
        if (Test-Path -LiteralPath $folder) { Remove-Item -LiteralPath $folder -Recurse -Force }
        [void](New-Item -ItemType Directory -Path $folder -Force)
    }
    $base = Join-Path $Work $Name
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $exe; $start.WorkingDirectory = $Package; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    foreach ($name in @('SCHELDEMIST_STARTUP_CACHE', 'SCHELDEMIST_STARTUP_SEED', 'SCHELDEMIST_ROOT', 'SCHELDEMIST_BAKE')) { [void]$start.Environment.Remove($name) }
    $start.Environment['SCHELDEMIST_USER_DATA'] = $data
    $start.Environment['PATH'] = Join-Path $env:SystemRoot 'System32'
    foreach ($key in $Environment.Keys) { $start.Environment[$key] = [string]$Environment[$key] }
    foreach ($argument in @('--rendering-method', 'forward_plus', '--disable-vsync', '--', '--no-ai', '--scene-seed', '--startup-profile', '--author-root', $layouts,
            '--port', "$Port", '--startup-timeout-minutes', "$LimitMinutes", '--startup-proof', "$base.json")) { $start.ArgumentList.Add($argument) }
    if (Test-Path -LiteralPath "$base.json") { Remove-Item -LiteralPath "$base.json" -Force }
    $child = [Diagnostics.Process]::new(); $child.StartInfo = $start
    [void]$child.Start()
    $stdout = $child.StandardOutput.ReadToEndAsync(); $stderr = $child.StandardError.ReadToEndAsync()
    try {
        if (-not $child.WaitForExit(($LimitMinutes + 10) * 60000)) { throw "$Name timed out" }
        $log = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()
        [IO.File]::WriteAllText("$base.log", $log)
        if ($child.ExitCode -ne 0 -or -not (Test-Path -LiteralPath "$base.json")) { throw "$Name did not reach play: $base.log" }
        $result = Get-Content -LiteralPath "$base.json" -Raw | ConvertFrom-Json
        return [pscustomobject]@{ Seconds = [math]::Round($result.playableMs / 1000, 1); Log = $log }
    } finally { if (-not $child.HasExited) { $child.Kill($true); $child.WaitForExit() }; $child.Dispose() }
}

[void](New-Item -ItemType Directory -Path $Work -Force)
if (-not $VerifyOnly) {
    if (Test-Path -LiteralPath $seed) { throw "The package already has a startup-cache folder: $seed" }
    if (Test-Path -LiteralPath $building) { Remove-Item -LiteralPath $building -Recurse -Force }
    [void](New-Item -ItemType Directory -Path $building -Force)
    $first = Start-Package 'build' @{ SCHELDEMIST_STARTUP_CACHE = $building }
    # a run without the cache spools into transient folders; none may ship
    Get-ChildItem -LiteralPath (Join-Path $building 'ruien') -Directory -Filter 'transient-*' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
    Get-ChildItem -LiteralPath $building -File -Recurse | Where-Object { $_.Name -match '\.tmp$' } | Remove-Item -Force
    Rename-Item -LiteralPath $building -NewName 'startup-cache'
    Write-Output "Built in $($first.Seconds) s"
}
if (-not (Test-Path -LiteralPath $seed)) { throw "No startup-cache folder in $Package" }
$before = @(Get-ChildItem -LiteralPath $seed -File -Recurse | ForEach-Object { "$($_.FullName)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" })
# (an empty cache folder of its own: the user's real one may hold the same entries from an earlier start)
$own = Join-Path $Work 'verify-cache'
if (Test-Path -LiteralPath $own) { Remove-Item -LiteralPath $own -Recurse -Force }
[void](New-Item -ItemType Directory -Path $own -Force)
$second = Start-Package 'verify' @{ SCHELDEMIST_STARTUP_CACHE = $own }
$after = @(Get-ChildItem -LiteralPath $seed -File -Recurse | ForEach-Object { "$($_.FullName)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" })
if (Compare-Object $before $after) { throw 'The verifying start changed the package cache: it must only be read.' }
# Only the copied dependency notes may be in the player's own folder.
$built = @(Get-ChildItem -LiteralPath $own -File -Recurse | Where-Object { $_.Name -ne 'dependencies.json' })
if ($built.Count) { throw "The verifying start built $($built.Count) cache files of its own (first: $($built[0].FullName)): the package cache did not serve them." }
if ($second.Log -notmatch 'startup cache: street cuts hit') { throw 'The verifying start did not take the street cuts from the package cache.' }
$size = (Get-ChildItem -LiteralPath $seed -File -Recurse | Measure-Object Length -Sum)
Write-Output ("Package cache: {0:N2} GB in {1} files. A start with empty user data reached play in {2} s and built nothing." -f ($size.Sum / 1GB), $size.Count, $second.Seconds)
