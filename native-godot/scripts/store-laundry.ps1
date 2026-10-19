param([string]$Blender, [string]$Godot, [ValidateRange(8800,9099)][int]$Port = 8979, [switch]$NoBuild)
# Issues #149 #160 #164: build the washing, its pegs, rings and wash pole, the horse trough and the cellar hatch
# (art-source/tools/blender/build_laundry.py) into .scratch/laundry-plain, store laundry.glb as the game's "laundry" pack
# (the additive intake: its pictures BC7 with mipmaps) and cellar_hatch.glb as the street-props kit's hatch model
# (store-cellar-hatch.gd). Only laundry.scn, laundry-resources/, laundry.extras.json, the two intake entries "laundry" and
# assets/models/street-furniture/ are replaced; every other stored model file is hashed before and checked after.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspace = [IO.Path]::GetFullPath((Join-Path $project '..'))
$plain = Join-Path $workspace '.scratch/laundry-plain'
$engine = Resolve-WorkshopGodot $Godot
if (-not $NoBuild) {
    if (-not $Blender) { $Blender = Join-Path $env:ProgramFiles 'Blender Foundation/Blender 5.2/blender.exe' }
    $log = Join-Path $workspace '.scratch/laundry-build.log'
    $p = Start-Process -FilePath $Blender -ArgumentList @('-b','--factory-startup','--disable-autoexec','--python-exit-code','1','-P','art-source/tools/blender/build_laundry.py','--','--out',$plain,'--no-shots') -WorkingDirectory $workspace -NoNewWindow -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
    if (-not $p.WaitForExit(1800000)) { $p.Kill($true); throw 'The laundry build exceeded thirty minutes.' }
    if ($p.ExitCode -ne 0 -or -not (Select-String -LiteralPath $log -Pattern 'LAUNDRY BUILD COMPLETE' -Quiet)) { throw "The laundry build failed; see $log." }
}
$models = Join-Path $project 'assets/game-models'
function Other-ModelHashes {
    $h = [Collections.Generic.SortedDictionary[string,string]]::new([StringComparer]::Ordinal)
    foreach ($f in Get-ChildItem -LiteralPath $models -Recurse -File) {
        $rel = [IO.Path]::GetRelativePath($models, $f.FullName).Replace('\','/')
        if ($rel -in @('laundry.scn','laundry.extras.json','intake.json','full-intake.json') -or $rel.StartsWith('laundry-resources/')) { continue }
        $h[$rel] = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash
    }
    return ,$h
}
$before = Other-ModelHashes
$proof = Join-Path $workspace ('.scratch/laundry-store-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $proof)
$aside = Join-Path $proof 'previous'; [void](New-Item -ItemType Directory -Path $aside)
$moved = @(); $done = $false; $oldData = $env:SCHELDEMIST_USER_DATA
try {
    $env:SCHELDEMIST_USER_DATA = Join-Path $proof 'userdata'
    foreach ($name in @('laundry.scn','laundry.extras.json','laundry-resources')) {
        $path = Join-Path $models $name
        if (Test-Path -LiteralPath $path) { Move-Item -LiteralPath $path -Destination (Join-Path $aside $name); $moved += $name }
    }
    Invoke-WorkshopEngine $engine $project @('--rendering-method','forward_plus','--path',$project,'--log-file',(Join-Path $proof 'live.log'),'res://recovery/recover-game-models.tscn','--','--no-ai','--port',$Port.ToString(),'--db',(Join-Path $proof 'game.sqlite'),'--prefs',(Join-Path $proof 'settings.json'),'--source-models',$plain,'--resume-intake','yes','--only','laundry','--author-root',(Join-Path $proof 'layouts')) (Join-Path $proof 'engine.log') 300
    if (-not (Test-Path -LiteralPath (Join-Path $models 'laundry.scn'))) { throw 'The intake did not store laundry.scn.' }
    Invoke-WorkshopEngine $engine $project @('--rendering-method','forward_plus','--path',$project,'-s','scripts/store-cellar-hatch.gd','--',(Join-Path $plain 'cellar_hatch.glb')) (Join-Path $proof 'hatch.log') 120
    $after = Other-ModelHashes
    if ($before.Count -ne $after.Count) { throw 'Storing changed another model inventory.' }
    foreach ($e in $before.GetEnumerator()) { if ($after[$e.Key] -ne $e.Value) { throw "Storing changed another model: $($e.Key)" } }
    $done = $true
    Write-Output "Laundry pack and cellar hatch stored ($proof)"
} finally {
    $env:SCHELDEMIST_USER_DATA = $oldData
    if (-not $done) {
        foreach ($name in $moved) {
            $path = Join-Path $models $name
            if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
            Move-Item -LiteralPath (Join-Path $aside $name) -Destination $path
        }
    }
    foreach ($name in @('userdata','layouts','game.sqlite','game.sqlite-wal','game.sqlite-shm','settings.json','previous')) {
        $target = Join-Path $proof $name
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    }
}
