param(
    [string]$SourceModels,
    [string]$Godot,
    [ValidateRange(8800,9119)][int]$Port = 8991
)
# Replace the ferry's stored scene after a rebuild (blender -b --factory-startup -P art-source/tools/blender/build_ferry.py
# -- --plain .scratch/ferry-plain/ferry.glb). The ferry, the Werf landing stage, its tidal bridge, the bridge's toe plate,
# the quay hinge and the ferry's gangway are one model. This copies the drawn height maps to assets/game-models/heights/ferry,
# imports them, takes the plain ferry.glb in again by the additive intake (its pictures stored as BC7), and removes the
# resources the old ferry scene alone reached. Only ferry.scn, ferry.extras.json, ferry-resources/, heights/ferry/ and the
# ferry entries of both intake manifests change: every other stored model file is hashed before and after. If anything
# fails the old files are put back. Evidence: .scratch/ferry-replace-*.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspace = [IO.Path]::GetFullPath((Join-Path $project '..'))
if (-not $SourceModels) { $SourceModels = Join-Path $workspace '.scratch/ferry-plain' }
$SourceModels = [IO.Path]::GetFullPath($SourceModels)
if (-not (Test-Path -LiteralPath (Join-Path $SourceModels 'ferry.glb'))) { throw 'Build the plain ferry.glb first (build_ferry.py -- --plain .scratch/ferry-plain/ferry.glb).' }
$heightSource = Join-Path $workspace 'art-source/client/public/models/ferry_heights'
if (-not (Test-Path -LiteralPath (Join-Path $heightSource 'stage_deck.png'))) { throw 'The drawn height maps are missing: run build_ferry.py.' }
$models = Join-Path $project 'assets/game-models'
$heights = Join-Path $models 'heights/ferry'
$owned = @('ferry.scn','ferry.extras.json','ferry-resources')
function Other-ModelHashes {
    $hashes = [Collections.Generic.SortedDictionary[string,string]]::new([StringComparer]::Ordinal)
    foreach ($file in Get-ChildItem -LiteralPath $models -Recurse -File) {
        $relative = [IO.Path]::GetRelativePath($models,$file.FullName).Replace('\','/')
        if ($relative -in @('ferry.scn','ferry.extras.json','intake.json','full-intake.json') -or $relative.StartsWith('ferry-resources/') -or $relative.StartsWith('heights/ferry/')) { continue }
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
    $manifest.Remove('ferry')
    $otherEntries[$name] = $manifest | ConvertTo-Json -Depth 30 -Compress
}
& dotnet build (Join-Path $project 'Scheldemist.Native.csproj') --nologo -v quiet
if ($LASTEXITCODE) { throw 'Native build failed.' }
$engine = Resolve-WorkshopGodot $Godot
$proof = Join-Path $workspace ('.scratch/ferry-replace-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $proof)
$aside = Join-Path $proof 'previous'
[void](New-Item -ItemType Directory -Path $aside)
$moved = @()
$oldData = $env:SCHELDEMIST_USER_DATA
$done = $false
try {
    $env:SCHELDEMIST_USER_DATA = Join-Path $proof 'userdata'
    # what the old ferry scene reached (the shared resources it alone owns go at the end)
    $oldReach = Join-Path $proof 'old-reach.json'
    Invoke-WorkshopEngine $engine $project @('--headless','--path',$project,'--log-file',(Join-Path $proof 'reach-live.log'),'--script','res://recovery/model-dependencies.gd','--','res://assets/game-models/ferry.scn',$oldReach) (Join-Path $proof 'reach.log') 120 | Out-Null
    # the drawn height maps, imported (lossless) before the game reads them
    if (Test-Path -LiteralPath $heights) { Move-Item -LiteralPath $heights -Destination (Join-Path $aside 'heights-ferry') }
    [void](New-Item -ItemType Directory -Path $heights -Force)
    Copy-Item -Path (Join-Path $heightSource '*.png') -Destination $heights
    Invoke-WorkshopEngine $engine $project @('--headless','--editor','--import','--path',$project,'--log-file',(Join-Path $proof 'picture-import-live.log')) (Join-Path $proof 'picture-import.log') 300 | Out-Null
    foreach ($name in $owned) {
        $path = Join-Path $models $name
        if (Test-Path -LiteralPath $path) { Move-Item -LiteralPath $path -Destination (Join-Path $aside $name); $moved += $name }
    }
    Invoke-WorkshopEngine $engine $project @('--rendering-method','forward_plus','--path',$project,'--log-file',(Join-Path $proof 'live.log'),'res://recovery/recover-game-models.tscn','--','--no-ai','--port',$Port.ToString(),'--db',(Join-Path $proof 'game.sqlite'),'--prefs',(Join-Path $proof 'settings.json'),'--source-models',$SourceModels,'--resume-intake','yes','--only','ferry','--author-root',(Join-Path $proof 'layouts')) (Join-Path $proof 'engine.log') 600 | Out-Null
    if (-not (Test-Path -LiteralPath (Join-Path $models 'ferry.scn'))) { throw 'The intake did not store ferry.scn.' }
    # the old scene's resources that no stored scene reaches any more
    $otherReach = Join-Path $proof 'other-reach.json'
    Invoke-WorkshopEngine $engine $project @('--headless','--path',$project,'--log-file',(Join-Path $proof 'other-live.log'),'--script','res://recovery/model-dependencies.gd','--','--except','res://assets/game-models/ferry.scn',$otherReach) (Join-Path $proof 'other.log') 120 | Out-Null
    $keep = [Collections.Generic.HashSet[string]]::new([string[]]@(Get-Content -LiteralPath $otherReach -Raw | ConvertFrom-Json))
    $orphans = @()
    foreach ($resource in @(Get-Content -LiteralPath $oldReach -Raw | ConvertFrom-Json)) {
        if ($keep.Contains($resource)) { continue }
        $file = Join-Path $project ($resource -replace '^res://','')
        if (Test-Path -LiteralPath $file) { $orphans += $file }
    }
    $after = Other-ModelHashes
    foreach ($entry in $before.GetEnumerator()) {
        if (-not $after.ContainsKey($entry.Key) -or $after[$entry.Key] -ne $entry.Value) { throw "Replacement changed another model: $($entry.Key)" }
    }
    if ($before.Count -ne $after.Count) { throw 'Replacement changed another model inventory.' }
    foreach ($name in @('intake.json','full-intake.json')) {
        $manifest = Get-Content -LiteralPath (Join-Path $models $name) -Raw | ConvertFrom-Json -AsHashtable
        $manifest.Remove('ferry')
        if (($manifest | ConvertTo-Json -Depth 30 -Compress) -ne $otherEntries[$name]) { throw "Replacement changed another entry in $name." }
    }
    $removed = $orphans.Count
    foreach ($file in $orphans) { Remove-Item -LiteralPath $file }
    $done = $true
    @{ ok = $true; otherModelFilesPreserved = $before.Count; otherManifestEntriesPreserved = $true; oldResourcesRemoved = $removed; sourceSha256 = (Get-FileHash -LiteralPath (Join-Path $SourceModels 'ferry.glb') -Algorithm SHA256).Hash } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $proof 'replacement.json')
    Write-Output "Ferry replaced ($removed old resources removed); preservation receipt: $proof/replacement.json"
} finally {
    $env:SCHELDEMIST_USER_DATA = $oldData
    if (-not $done) {
        foreach ($name in $manifestBytes.Keys) { [IO.File]::WriteAllBytes((Join-Path $models $name),$manifestBytes[$name]) }
        foreach ($name in $owned) {
            $path = Join-Path $models $name
            if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
            if ($name -in $moved) { Move-Item -LiteralPath (Join-Path $aside $name) -Destination $path }
        }
        if (Test-Path -LiteralPath $heights) { Remove-Item -LiteralPath $heights -Recurse -Force }
        if (Test-Path -LiteralPath (Join-Path $aside 'heights-ferry')) { Move-Item -LiteralPath (Join-Path $aside 'heights-ferry') -Destination $heights }
    }
    foreach ($name in @('userdata','layouts','game.sqlite','game.sqlite-wal','game.sqlite-shm','settings.json','previous')) {
        $target = [IO.Path]::GetFullPath((Join-Path $proof $name))
        if (-not $target.StartsWith($proof + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup escaped its proof directory.' }
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    }
}
