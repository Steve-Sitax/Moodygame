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
    $names = [Collections.Generic.HashSet[string]]::new()
    foreach ($picture in $receipt.pictures) {
        $expectedHour = if ($picture.file -like '*-lamps-*') { 19.5 } else { 13 }
        $expectedWeather = if ($picture.file -like '*-rain-*') { 'rain' } else { 'clear' }
        if (-not $names.Add($picture.file) -or -not (Test-Path -LiteralPath (Join-Path $proof $picture.file)) -or
            -not $picture.defaultRouting -or $picture.hour -ne $expectedHour -or $picture.weather -ne $expectedWeather -or
            $picture.place -notin @('vismarkt','rijnkaai') -or $picture.metres -notin @(3,8) -or
            @($picture.people | Where-Object Newer).Count -eq 0 -or @($picture.people | Where-Object { -not $_.Newer }).Count -eq 0) {
            throw "Invalid default-game picture receipt: $($picture.file)"
        }
    }
    Write-Output "Default game evidence: $proof"
} finally {
    $env:SCHELDEMIST_USER_DATA = $oldData; $env:SCHELDEMIST_TOWN_SEED = $oldSeed
    foreach ($name in @('userdata','layouts','game.sqlite','game.sqlite-wal','game.sqlite-shm','settings.json')) {
        $target = [IO.Path]::GetFullPath((Join-Path $proof $name))
        if (-not $target.StartsWith($proof + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup escaped proof directory.' }
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    }
}
