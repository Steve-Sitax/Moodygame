param([string]$Godot, [switch]$SceneSeed, [switch]$ReviewSurfaces, [switch]$SurfaceOnly, [string]$District = 'rijnkaai-recovered', [string]$Visuals = 'res://game/rijnkaai')
$ErrorActionPreference = 'Stop'
if (-not ($SurfaceOnly -or $ReviewSurfaces)) {
    & (Join-Path $PSScriptRoot 'open-native-town.ps1') -Godot $Godot -SceneSeed:$SceneSeed
    exit $LASTEXITCODE
}
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$nativeGameProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nativeGameEngine = Resolve-WorkshopGodot $Godot
& dotnet build $nativeGameProject --nologo
if ($LASTEXITCODE -ne 0) { throw 'Build failed; the game was not launched.' }
Update-WorkshopImports $nativeGameEngine $nativeGameProject
$nativeGameSettings = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'ScheldemistWorkshop\native-game-settings.json'
$nativeGameArguments = @('--rendering-method', 'forward_plus', '--path', $nativeGameProject, 'res://game.tscn', '--', '--district', $District, '--visuals', $Visuals)
$nativeGameArguments += @('--surface-only', '--no-mainmenu', '--prefs', $nativeGameSettings)
if ($SceneSeed) { $nativeGameArguments += '--scene-seed' }
if ($ReviewSurfaces) { $nativeGameArguments += '--review-surfaces' }
& $nativeGameEngine @nativeGameArguments
exit $LASTEXITCODE
