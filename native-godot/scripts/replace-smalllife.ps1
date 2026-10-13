param(
    [string]$SourceModels,
    [string]$Godot,
    [ValidateRange(8800,9119)][int]$Port = 8990
)
# Replace the small-life stored scene after a rebuild (art-source/tools/blender/build_smalllife.py --plain ...): import the
# animal pictures (native-godot/assets/smalllife, BPTC colour and RGTC normals), take the plain smalllife.glb in
# again by the additive intake, and prepare the native package. Only smalllife.scn, smalllife-resources/ and
# smalllife.extras.json are replaced (moved aside first and put back if anything fails); every other stored model file
# and the other entries of both intake manifests are hashed before and checked after. Evidence: .scratch/smalllife-replace-*.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspace = [IO.Path]::GetFullPath((Join-Path $project '..'))
if (-not $SourceModels) { $SourceModels = Join-Path $workspace '.scratch/smalllife-plain' }
$SourceModels = [IO.Path]::GetFullPath($SourceModels)
if (-not (Test-Path -LiteralPath (Join-Path $SourceModels 'smalllife.glb'))) { throw 'Build the plain smalllife.glb first (build_smalllife.py --plain .scratch/smalllife-plain/smalllife.glb).' }
$pictures = Join-Path $project 'assets/smalllife'
if (-not (Test-Path -LiteralPath (Join-Path $pictures 'goat_colour.png'))) { throw 'The animal pictures are missing: rebuild the smalllife.' }
$models = Join-Path $project 'assets/game-models'
$owned = @('smalllife.scn','smalllife.extras.json','smalllife-resources')
function Other-ModelHashes {
    $hashes = [Collections.Generic.SortedDictionary[string,string]]::new([StringComparer]::Ordinal)
    foreach ($file in Get-ChildItem -LiteralPath $models -Recurse -File) {
        $relative = [IO.Path]::GetRelativePath($models,$file.FullName).Replace('\','/')
        if ($relative -in @('smalllife.scn','smalllife.extras.json','intake.json','full-intake.json') -or $relative.StartsWith('smalllife-resources/')) { continue }
        $hashes[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    }
    return ,$hashes
}
$before = Other-ModelHashes
$otherEntries = @{}
$manifestBytes = @{}
foreach ($name in @('intake.json','full-intake.json')) {
    $manifestBytes[$name] = [IO.File]::ReadAllBytes((Join-Path $models $name))
    $manifest = Get-Content -LiteralPath (Join-Path $models $name) -Raw | ConvertFrom-Json -AsHashtable
    $manifest.Remove('smalllife')
    $otherEntries[$name] = $manifest | ConvertTo-Json -Depth 30 -Compress
}
& dotnet build (Join-Path $project 'Scheldemist.Native.csproj') --nologo -v quiet
if ($LASTEXITCODE) { throw 'Native build failed.' }
$proof = Join-Path $workspace ('.scratch/smalllife-replace-' + [guid]::NewGuid().ToString('N'))
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
    Invoke-WorkshopEngine (Resolve-WorkshopGodot $Godot) $project @('--rendering-method','forward_plus','--path',$project,'--log-file',(Join-Path $proof 'live.log'),'res://recovery/recover-game-models.tscn','--','--no-ai','--port',$Port.ToString(),'--db',(Join-Path $proof 'game.sqlite'),'--prefs',(Join-Path $proof 'settings.json'),'--source-models',$SourceModels,'--resume-intake','yes','--only','smalllife','--author-root',(Join-Path $proof 'layouts')) (Join-Path $proof 'engine.log') 300
    if (-not (Test-Path -LiteralPath (Join-Path $models 'smalllife.scn'))) { throw 'The intake did not store smalllife.scn.' }
    Invoke-WorkshopEngine (Resolve-WorkshopGodot $Godot) $project @('--headless','--path',$project,'--log-file',(Join-Path $proof 'lod-live.log'),'--script','res://recovery/smalllife-lods.gd') (Join-Path $proof 'lods.log') 90
    $after = Other-ModelHashes
    if ($before.Count -ne $after.Count) { throw 'Replacement changed another model inventory.' }
    foreach ($entry in $before.GetEnumerator()) {
        if (-not $after.ContainsKey($entry.Key) -or $after[$entry.Key] -ne $entry.Value) { throw "Replacement changed another model: $($entry.Key)" }
    }
    foreach ($name in @('intake.json','full-intake.json')) {
        $manifest = Get-Content -LiteralPath (Join-Path $models $name) -Raw | ConvertFrom-Json -AsHashtable
        $manifest.Remove('smalllife')
        if (($manifest | ConvertTo-Json -Depth 30 -Compress) -ne $otherEntries[$name]) { throw "Replacement changed another entry in $name." }
    }
    & (Join-Path $PSScriptRoot 'prepare-native-package.ps1') -Project $project
    $done = $true
    @{ ok = $true; otherModelFilesPreserved = $before.Count; otherManifestEntriesPreserved = $true; sourceSha256 = (Get-FileHash -LiteralPath (Join-Path $SourceModels 'smalllife.glb') -Algorithm SHA256).Hash } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $proof 'replacement.json')
    Write-Output "Small life replaced; preservation receipt: $proof/replacement.json"
} finally {
    $env:SCHELDEMIST_USER_DATA = $oldData
    if (-not $done) {
        foreach($name in $manifestBytes.Keys){[IO.File]::WriteAllBytes((Join-Path $models $name),$manifestBytes[$name])}
        # put the previous smalllife back
        foreach ($name in $owned) {
            $path = Join-Path $models $name
            if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
            if($name -in $moved){Move-Item -LiteralPath (Join-Path $aside $name) -Destination $path}
        }
    }
    foreach ($name in @('userdata','layouts','game.sqlite','game.sqlite-wal','game.sqlite-shm','settings.json','previous')) {
        $target = [IO.Path]::GetFullPath((Join-Path $proof $name))
        if (-not $target.StartsWith($proof + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup escaped its proof directory.' }
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    }
}

