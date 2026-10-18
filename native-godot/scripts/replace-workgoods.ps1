param(
    [string]$SourceModels,
    [string]$Godot,
    [ValidateRange(8800,9099)][int]$Port = 8978
)
# Store or replace the work goods' scene after a rebuild (build-workgoods.ps1: the knife, the herring, the open ledger,
# the crab winch and the emigrants' and carts' luggage and goods, #131 #151 #128): take the plain workgoods.glb in by the
# additive intake (its one picture stored as BC7 with mipmaps) and prepare the native package. Only workgoods.scn,
# workgoods-resources/ and workgoods.extras.json are replaced (moved aside first and put back if anything fails); every
# other stored model file and the other entries of both intake manifests are hashed before and checked after.
# Evidence: .scratch/workgoods-replace-*.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspace = [IO.Path]::GetFullPath((Join-Path $project '..'))
if (-not $SourceModels) { $SourceModels = Join-Path $workspace '.scratch/workgoods-plain' }
$SourceModels = [IO.Path]::GetFullPath($SourceModels)
if (-not (Test-Path -LiteralPath (Join-Path $SourceModels 'workgoods.glb'))) { throw 'Build the plain workgoods.glb first (build-workgoods.ps1).' }
$models = Join-Path $project 'assets/game-models'
$owned = @('workgoods.scn','workgoods.extras.json','workgoods-resources')
function Other-ModelHashes {
    $hashes = [Collections.Generic.SortedDictionary[string,string]]::new([StringComparer]::Ordinal)
    foreach ($file in Get-ChildItem -LiteralPath $models -Recurse -File) {
        $relative = [IO.Path]::GetRelativePath($models,$file.FullName).Replace('\','/')
        if ($relative -in @('workgoods.scn','workgoods.extras.json','intake.json','full-intake.json') -or $relative.StartsWith('workgoods-resources/')) { continue }
        $hashes[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    }
    return ,$hashes
}
$before = Other-ModelHashes
$otherEntries = @{}
foreach ($name in @('intake.json','full-intake.json')) {
    $manifest = Get-Content -LiteralPath (Join-Path $models $name) -Raw | ConvertFrom-Json -AsHashtable
    $manifest.Remove('workgoods')
    $otherEntries[$name] = $manifest | ConvertTo-Json -Depth 30 -Compress
}
& dotnet build (Join-Path $project 'Scheldemist.Native.csproj') --nologo -v quiet
if ($LASTEXITCODE) { throw 'Native build failed.' }
$proof = Join-Path $workspace ('.scratch/workgoods-replace-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $proof)
$aside = Join-Path $proof 'previous'
[void](New-Item -ItemType Directory -Path $aside)
$moved = @()
$oldData = $env:SCHELDEMIST_USER_DATA
$done = $false
try {
    $env:SCHELDEMIST_USER_DATA = Join-Path $proof 'userdata'
    foreach ($name in $owned) {
        $path = Join-Path $models $name
        if (Test-Path -LiteralPath $path) { Move-Item -LiteralPath $path -Destination (Join-Path $aside $name); $moved += $name }
    }
    Invoke-WorkshopEngine (Resolve-WorkshopGodot $Godot) $project @('--rendering-method','forward_plus','--path',$project,'--log-file',(Join-Path $proof 'live.log'),'res://recovery/recover-game-models.tscn','--','--no-ai','--port',$Port.ToString(),'--db',(Join-Path $proof 'game.sqlite'),'--prefs',(Join-Path $proof 'settings.json'),'--source-models',$SourceModels,'--resume-intake','yes','--only','workgoods','--author-root',(Join-Path $proof 'layouts')) (Join-Path $proof 'engine.log') 300
    if (-not (Test-Path -LiteralPath (Join-Path $models 'workgoods.scn'))) { throw 'The intake did not store workgoods.scn.' }
    $after = Other-ModelHashes
    if ($before.Count -ne $after.Count) { throw 'Replacement changed another model inventory.' }
    foreach ($entry in $before.GetEnumerator()) {
        if (-not $after.ContainsKey($entry.Key) -or $after[$entry.Key] -ne $entry.Value) { throw "Replacement changed another model: $($entry.Key)" }
    }
    foreach ($name in @('intake.json','full-intake.json')) {
        $manifest = Get-Content -LiteralPath (Join-Path $models $name) -Raw | ConvertFrom-Json -AsHashtable
        $manifest.Remove('workgoods')
        if (($manifest | ConvertTo-Json -Depth 30 -Compress) -ne $otherEntries[$name]) { throw "Replacement changed another entry in $name." }
    }
    & (Join-Path $PSScriptRoot 'prepare-native-package.ps1') -Project $project
    $done = $true
    @{ ok = $true; otherModelFilesPreserved = $before.Count; otherManifestEntriesPreserved = $true; sourceSha256 = (Get-FileHash -LiteralPath (Join-Path $SourceModels 'workgoods.glb') -Algorithm SHA256).Hash } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $proof 'replacement.json')
    Write-Output "Work goods stored; preservation receipt: $proof/replacement.json"
} finally {
    $env:SCHELDEMIST_USER_DATA = $oldData
    if (-not $done) {
        # put the previous workgoods back
        foreach ($name in $moved) {
            $path = Join-Path $models $name
            if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
            Move-Item -LiteralPath (Join-Path $aside $name) -Destination $path
        }
    }
    foreach ($name in @('userdata','layouts','game.sqlite','game.sqlite-wal','game.sqlite-shm','settings.json','previous')) {
        $target = [IO.Path]::GetFullPath((Join-Path $proof $name))
        if (-not $target.StartsWith($proof + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup escaped its proof directory.' }
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    }
}
