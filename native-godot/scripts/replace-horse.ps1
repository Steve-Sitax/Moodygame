param(
    [string]$SourceModels,
    [string]$Godot,
    [ValidateRange(8800,9099)][int]$Port = 9003
)
# Store or replace the horse's scene after a rebuild (art-source/tools/blender/build_horse.py --plain ...): import the
# horse pictures (native-godot/assets/horse-pictures, BPTC colour and RGTC normals), take the plain horse.glb in by the
# additive intake, and prepare the native package. Only horse.scn, horse-resources/ and horse.extras.json are replaced
# (moved aside first and put back if anything fails); every other stored model file and the other entries of both
# intake manifests are hashed before and checked after. Evidence: .scratch/horse-replace-*.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspace = [IO.Path]::GetFullPath((Join-Path $project '..'))
if (-not $SourceModels) { $SourceModels = Join-Path $workspace '.scratch/horse-plain' }
$SourceModels = [IO.Path]::GetFullPath($SourceModels)
if (-not (Test-Path -LiteralPath (Join-Path $SourceModels 'horse.glb'))) { throw 'Build the plain horse.glb first (build_horse.py --plain .scratch/horse-plain/horse.glb).' }
$pictures = Join-Path $project 'assets/horse-pictures'
if (-not (Test-Path -LiteralPath (Join-Path $pictures 'horse_normal.png'))) { throw 'The horse pictures are missing: rebuild the horse.' }
$models = Join-Path $project 'assets/game-models'
$owned = @('horse.scn','horse.extras.json','horse-resources')
function Other-ModelHashes {
    $hashes = [Collections.Generic.SortedDictionary[string,string]]::new([StringComparer]::Ordinal)
    foreach ($file in Get-ChildItem -LiteralPath $models -Recurse -File) {
        $relative = [IO.Path]::GetRelativePath($models,$file.FullName).Replace('\','/')
        if ($relative -in @('horse.scn','horse.extras.json','intake.json','full-intake.json') -or $relative.StartsWith('horse-resources/')) { continue }
        $hashes[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    }
    return ,$hashes
}
$before = Other-ModelHashes
$otherEntries = @{}
foreach ($name in @('intake.json','full-intake.json')) {
    $manifest = Get-Content -LiteralPath (Join-Path $models $name) -Raw | ConvertFrom-Json -AsHashtable
    $manifest.Remove('horse')
    $otherEntries[$name] = $manifest | ConvertTo-Json -Depth 30 -Compress
}
& dotnet build (Join-Path $project 'Scheldemist.Native.csproj') --nologo -v quiet
if ($LASTEXITCODE) { throw 'Native build failed.' }
$proof = Join-Path $workspace ('.scratch/horse-replace-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $proof)
$aside = Join-Path $proof 'previous'
[void](New-Item -ItemType Directory -Path $aside)
$moved = @()
$oldData = $env:SCHELDEMIST_USER_DATA
$done = $false
try {
    $env:SCHELDEMIST_USER_DATA = Join-Path $proof 'userdata'
    # the pictures to persistent BPTC/RGTC resources before the game reads them
    Invoke-WorkshopEngine (Resolve-WorkshopGodot $Godot) $project @('--headless','--editor','--import','--path',$project,'--log-file',(Join-Path $proof 'picture-import-live.log')) (Join-Path $proof 'picture-import.log') 300 | Out-Null
    foreach ($name in $owned) {
        $path = Join-Path $models $name
        if (Test-Path -LiteralPath $path) { Move-Item -LiteralPath $path -Destination (Join-Path $aside $name); $moved += $name }
    }
    Invoke-WorkshopEngine (Resolve-WorkshopGodot $Godot) $project @('--rendering-method','forward_plus','--path',$project,'--log-file',(Join-Path $proof 'live.log'),'res://recovery/recover-game-models.tscn','--','--no-ai','--port',$Port.ToString(),'--db',(Join-Path $proof 'game.sqlite'),'--prefs',(Join-Path $proof 'settings.json'),'--source-models',$SourceModels,'--resume-intake','yes','--only','horse','--author-root',(Join-Path $proof 'layouts')) (Join-Path $proof 'engine.log') 300
    if (-not (Test-Path -LiteralPath (Join-Path $models 'horse.scn'))) { throw 'The intake did not store horse.scn.' }
    $after = Other-ModelHashes
    if ($before.Count -ne $after.Count) { throw 'Replacement changed another model inventory.' }
    foreach ($entry in $before.GetEnumerator()) {
        if (-not $after.ContainsKey($entry.Key) -or $after[$entry.Key] -ne $entry.Value) { throw "Replacement changed another model: $($entry.Key)" }
    }
    foreach ($name in @('intake.json','full-intake.json')) {
        $manifest = Get-Content -LiteralPath (Join-Path $models $name) -Raw | ConvertFrom-Json -AsHashtable
        $manifest.Remove('horse')
        if (($manifest | ConvertTo-Json -Depth 30 -Compress) -ne $otherEntries[$name]) { throw "Replacement changed another entry in $name." }
    }
    & (Join-Path $PSScriptRoot 'prepare-native-package.ps1') -Project $project
    $done = $true
    @{ ok = $true; otherModelFilesPreserved = $before.Count; otherManifestEntriesPreserved = $true; sourceSha256 = (Get-FileHash -LiteralPath (Join-Path $SourceModels 'horse.glb') -Algorithm SHA256).Hash } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $proof 'replacement.json')
    Write-Output "Horse stored; preservation receipt: $proof/replacement.json"
} finally {
    $env:SCHELDEMIST_USER_DATA = $oldData
    if (-not $done) {
        # put the previous horse back
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
