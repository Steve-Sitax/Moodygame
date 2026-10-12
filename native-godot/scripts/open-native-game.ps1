param([string]$Godot, [switch]$SceneSeed, [switch]$ReviewSurfaces, [string]$District = 'rijnkaai-recovered', [string]$Visuals = 'res://game/rijnkaai')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$nativeGameProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nativeGameEngine = Resolve-WorkshopGodot $Godot
& dotnet build $nativeGameProject --nologo
if ($LASTEXITCODE -ne 0) { throw 'Build failed; the game was not launched.' }
$nativeGameSettings = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'ScheldemistWorkshop\native-game-settings.json'
$nativeGameArguments = @('--rendering-method', 'forward_plus', '--path', $nativeGameProject, 'res://game.tscn', '--', '--no-mainmenu', '--prefs', $nativeGameSettings, '--district', $District, '--visuals', $Visuals)
if ($SceneSeed) { $nativeGameArguments += '--scene-seed' }
if ($ReviewSurfaces) { $nativeGameArguments += '--review-surfaces' }
& $nativeGameEngine @nativeGameArguments
exit $LASTEXITCODE
