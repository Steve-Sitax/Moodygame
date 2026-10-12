param([string]$Godot, [switch]$SceneSeed, [switch]$ReviewSurfaces, [switch]$SurfaceOnly, [string]$District = 'rijnkaai-recovered', [string]$Visuals = 'res://game/rijnkaai')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$nativeGameProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nativeGameEngine = Resolve-WorkshopGodot $Godot
& dotnet build $nativeGameProject --nologo
if ($LASTEXITCODE -ne 0) { throw 'Build failed; the game was not launched.' }
$nativeGameSettings = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'ScheldemistWorkshop\native-game-settings.json'
$nativeGameArguments = @('--rendering-method', 'forward_plus', '--path', $nativeGameProject, 'res://game.tscn', '--', '--district', $District, '--visuals', $Visuals)
if ($SurfaceOnly -or $ReviewSurfaces) {
    $nativeGameArguments += @('--surface-only', '--no-mainmenu', '--prefs', $nativeGameSettings)
} else {
    $nativePlayData = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'ScheldemistWorkshop\playtest'
    [void](New-Item -ItemType Directory -Path $nativePlayData -Force)
    $env:SCHELDEMIST_USER_DATA = $nativePlayData
    $nativeGameArguments += @('--no-ai', '--db', (Join-Path $nativePlayData 'game.sqlite'), '--prefs', (Join-Path $nativePlayData 'settings.json'))
}
if ($SceneSeed) { $nativeGameArguments += '--scene-seed' }
if ($ReviewSurfaces) { $nativeGameArguments += '--review-surfaces' }
& $nativeGameEngine @nativeGameArguments
exit $LASTEXITCODE
