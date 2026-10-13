param([string]$Godot, [ValidateRange(8800,9118)][int]$Port = 9108)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspace = [IO.Path]::GetFullPath((Join-Path $project '..'))
$proof = Join-Path $workspace ('.scratch/batch1-game-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $proof)
& dotnet build (Join-Path $project 'Scheldemist.Native.csproj') --nologo -v quiet
if ($LASTEXITCODE) { throw 'Native build failed.' }
& (Join-Path $PSScriptRoot 'prepare-native-package.ps1') -Project $project
$oldData = $env:SCHELDEMIST_USER_DATA
$oldSeed = $env:SCHELDEMIST_TOWN_SEED
try {
    $env:SCHELDEMIST_USER_DATA = Join-Path $proof 'userdata'
    $env:SCHELDEMIST_TOWN_SEED = '1873'
    Invoke-WorkshopEngine (Resolve-WorkshopGodot $Godot) $project @('--rendering-method','forward_plus','--path',$project,'--log-file',(Join-Path $proof 'live.log'),'res://town.tscn','--','--no-ai','--no-mainmenu','--dev','--port',$Port.ToString(),'--db',(Join-Path $proof 'game.sqlite'),'--prefs',(Join-Path $proof 'settings.json'),'--author-root',(Join-Path $proof 'layouts'),'--native-pack-test','--batch1-captures',$proof) (Join-Path $proof 'engine.log') 900
    $receipt = Get-Content (Join-Path $proof 'default-game.json') -Raw | ConvertFrom-Json
    if (-not $receipt.ok -or $receipt.pictures.Count -ne 12) { throw 'Default-game capture proof failed.' }
    Write-Output "Default game evidence: $proof"
} finally {
    $env:SCHELDEMIST_USER_DATA = $oldData; $env:SCHELDEMIST_TOWN_SEED = $oldSeed
    foreach ($name in @('userdata','layouts','game.sqlite','game.sqlite-wal','game.sqlite-shm','settings.json')) {
        $target = [IO.Path]::GetFullPath((Join-Path $proof $name))
        if (-not $target.StartsWith($proof + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup escaped proof directory.' }
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    }
}
