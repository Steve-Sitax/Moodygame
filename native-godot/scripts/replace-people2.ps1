param(
    [string]$SourceModels,
    [string]$Rig,
    [string]$Godot,
    [ValidateRange(8800,9139)][int]$Port = 8900
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspace = [IO.Path]::GetFullPath((Join-Path $project '..'))
if (-not $SourceModels) { $SourceModels = Join-Path $workspace '.scratch/people2-plain' }
if (-not $Rig) { $Rig = Join-Path $workspace 'art-source/shared/peopleRig.json' }
$SourceModels = [IO.Path]::GetFullPath($SourceModels)
$Rig = [IO.Path]::GetFullPath($Rig)
if (-not (Test-Path -LiteralPath (Join-Path $SourceModels 'people2.glb')) -or -not (Test-Path -LiteralPath $Rig)) { throw 'Build the plain people2 GLB and its rig before replacement.' }
$rigData = Get-Content -LiteralPath $Rig -Raw | ConvertFrom-Json
foreach ($kind in @('docker_a','fishwife_a','police','sooi')) {
    if (-not $rigData.kinds.$kind) { throw "The rig is missing dressed kind $kind." }
}
$models = Join-Path $project 'assets/game-models'
function Other-ModelHashes {
    $hashes = [Collections.Generic.SortedDictionary[string,string]]::new([StringComparer]::Ordinal)
    foreach ($file in Get-ChildItem -LiteralPath $models -Recurse -File) {
        $relative = [IO.Path]::GetRelativePath($models,$file.FullName).Replace('\','/')
        if ($relative -in @('people2.scn','people2.extras.json','intake.json','full-intake.json') -or $relative.StartsWith('people2-resources/') -or $relative.StartsWith('people2_')) { continue }
        $hashes[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    }
    return ,$hashes
}
$before = Other-ModelHashes
$otherEntries = @{}
foreach ($name in @('intake.json','full-intake.json')) {
    $manifest = Get-Content -LiteralPath (Join-Path $models $name) -Raw | ConvertFrom-Json -AsHashtable
    $manifest.Remove('people2')
    $otherEntries[$name] = $manifest | ConvertTo-Json -Depth 30 -Compress
}
& dotnet build (Join-Path $project 'Scheldemist.Native.csproj') --nologo -v quiet
if ($LASTEXITCODE) { throw 'Native build failed.' }
$proof = Join-Path $workspace ('.scratch/people2-replace-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $proof)
$oldData = $env:SCHELDEMIST_USER_DATA
try {
    $env:SCHELDEMIST_USER_DATA = Join-Path $proof 'userdata'
    # Import source PNGs to persistent BPTC/RGTC resources before the runtime assembles arrays.
    Invoke-WorkshopEngine (Resolve-WorkshopGodot $Godot) $project @('--headless','--editor','--import','--path',$project,'--log-file',(Join-Path $proof 'picture-import-live.log')) (Join-Path $proof 'picture-import.log') 240 | Out-Null
    # Forward+ is required: the headless dummy renderer does not retain ImageTexture images.
    Invoke-WorkshopEngine (Resolve-WorkshopGodot $Godot) $project @('--rendering-method','forward_plus','--path',$project,'--log-file',(Join-Path $proof 'live.log'),'res://recovery/recover-game-models.tscn','--','--no-ai','--port',$Port.ToString(),'--db',(Join-Path $proof 'game.sqlite'),'--prefs',(Join-Path $proof 'settings.json'),'--source-models',$SourceModels,'--resume-intake','yes','--only','people2','--replace','people2','--author-root',(Join-Path $proof 'layouts')) (Join-Path $proof 'engine.log') 900
    $after = Other-ModelHashes
    if ($before.Count -ne $after.Count) { throw 'Replacement changed another model inventory.' }
    foreach ($entry in $before.GetEnumerator()) {
        if (-not $after.ContainsKey($entry.Key) -or $after[$entry.Key] -ne $entry.Value) { throw "Replacement changed another model: $($entry.Key)" }
    }
    foreach ($name in @('intake.json','full-intake.json')) {
        $manifest = Get-Content -LiteralPath (Join-Path $models $name) -Raw | ConvertFrom-Json -AsHashtable
        $manifest.Remove('people2')
        if (($manifest | ConvertTo-Json -Depth 30 -Compress) -ne $otherEntries[$name]) { throw "Replacement changed another entry in $name." }
    }
    Copy-Item -LiteralPath $Rig -Destination (Join-Path $project 'world/data/shared/peopleRig.json')
    # the faces' recipe and the sliders travel with the rig (written beside it by the build)
    foreach ($extra in @('faceTypes.json','peopleSliders.json')) {
        $from = Join-Path (Split-Path -Parent $Rig) $extra
        if (-not (Test-Path -LiteralPath $from)) { throw "The build wrote no $extra beside the rig." }
        Copy-Item -LiteralPath $from -Destination (Join-Path $project ('world/data/shared/' + $extra))
    }
    & (Join-Path $PSScriptRoot 'prepare-native-package.ps1') -Project $project
    @{ ok = $true; otherModelFilesPreserved = $before.Count; otherManifestEntriesPreserved = $true; sourceSha256 = (Get-FileHash -LiteralPath (Join-Path $SourceModels 'people2.glb') -Algorithm SHA256).Hash; triangles = $rigData.kinds } | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $proof 'replacement.json')
    Write-Output "People2 replaced; preservation receipt: $proof/replacement.json"
} finally {
    $env:SCHELDEMIST_USER_DATA = $oldData
    foreach ($name in @('userdata','layouts','game.sqlite','game.sqlite-wal','game.sqlite-shm','settings.json')) {
        $target = [IO.Path]::GetFullPath((Join-Path $proof $name))
        if (-not $target.StartsWith($proof + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Intake cleanup escaped its proof directory.' }
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    }
}
