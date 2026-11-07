# Tests compile-time cache revisions without editing any existing source file.
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$proofDir = Join-Path $workspace '.scratch/startup-perf'
[void][IO.Directory]::CreateDirectory($proofDir)
$tag = [guid]::NewGuid().ToString('N')
$unrelated = Join-Path $workspace "native-godot/scripts/StartupRevisionFixture_$tag.cs"
$geometry = Join-Path $workspace "godot/src/World/StartupRevisionFixture_$tag.cs"
foreach ($file in @($unrelated,$geometry)) {
    if (-not ([IO.Path]::GetFullPath($file)).StartsWith($workspace + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $file)) { throw "Unsafe fixture path: $file" }
}
$script:buildNumber = 0
function Build-Proof {
    $script:buildNumber++
    & dotnet build (Join-Path $workspace 'native-godot/Scheldemist.Native.csproj') --nologo -v quiet *> (Join-Path $proofDir "revision-build-$script:buildNumber.log")
    if ($LASTEXITCODE -ne 0) { throw "Build $script:buildNumber failed" }
}
function Revisions {
    $values = @{}
    foreach ($project in @('godot','native-godot')) {
        $generated = @(Get-ChildItem -LiteralPath (Join-Path $workspace "$project/.godot/mono/temp/obj/Debug") -Filter StartupGeometryRevision.g.cs -Recurse)
        if ($generated.Count -ne 1) { throw "Expected one geometry revision for $project" }
        $match = [regex]::Match([IO.File]::ReadAllText($generated[0].FullName),'"([0-9A-F]{64})"')
        if (-not $match.Success) { throw "Missing geometry revision: $project" }
        $values[$project] = $match.Groups[1].Value
    }
    return $values
}
function Same($a,$b) { return $a['godot'] -eq $b['godot'] -and $a['native-godot'] -eq $b['native-godot'] }
$assembly = Join-Path $workspace 'native-godot/.godot/mono/temp/bin/Debug/Scheldemist.Native.dll'
try {
    Build-Proof
    $baseline = Revisions
    $dllBefore = (Get-FileHash -LiteralPath $assembly).Hash
    [IO.File]::WriteAllText($unrelated,"internal static class StartupRevisionFixture_$tag { public const int Value = 1; }")
    Build-Proof
    if (-not (Same $baseline (Revisions))) { throw 'Unrelated code invalidated geometry' }
    if ((Get-FileHash -LiteralPath $assembly).Hash -eq $dllBefore) { throw 'Unrelated fixture did not change the assembly' }
    [IO.File]::WriteAllText($geometry,"internal static class GeometryRevisionFixture_$tag { public const int Value = 1; }")
    Build-Proof
    $changed = Revisions
    if ($changed['godot'] -eq $baseline['godot']) { throw 'New geometry source failed to invalidate' }
    $time = [IO.File]::GetLastWriteTimeUtc($geometry)
    [IO.File]::WriteAllText($geometry,"internal static class GeometryRevisionFixture_$tag { public const int Value = 2; }")
    [IO.File]::SetLastWriteTimeUtc($geometry,$time)
    Build-Proof
    if ((Revisions)['godot'] -eq $changed['godot']) { throw 'Geometry content change with preserved timestamp was missed' }
} finally {
    # Exact fixture paths were checked before creation. Never remove existing source or directories.
    foreach ($file in @($unrelated,$geometry)) { if ([IO.File]::Exists($file)) { [IO.File]::Delete($file) } }
    Build-Proof
}
if (-not (Same $baseline (Revisions))) { throw 'Restored source did not restore the original revision' }
'PASS: unrelated compiled changes reuse geometry; new/changed geometry invalidates, even with preserved timestamps; restored sources restore the revision.'
