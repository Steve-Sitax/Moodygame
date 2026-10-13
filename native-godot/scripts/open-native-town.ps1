param([string]$Godot, [switch]$SceneSeed, [string]$DataDirectory)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$nativeTownProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nativeTownEngine = Resolve-WorkshopGodot $Godot
& (Join-Path $PSScriptRoot 'prepare-native-package.ps1') -Project $nativeTownProject
& dotnet build (Join-Path $nativeTownProject 'Scheldemist.Native.csproj') --nologo
if ($LASTEXITCODE -ne 0) { throw 'Build failed; the game was not launched.' }
Update-WorkshopImports $nativeTownEngine $nativeTownProject
if (-not $DataDirectory) {
    $DataDirectory = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'ScheldemistWorkshop\native-playtest'
}
$nativeTownData = [IO.Path]::GetFullPath($DataDirectory)
[void](New-Item -ItemType Directory -Path $nativeTownData -Force)
$env:SCHELDEMIST_USER_DATA = $nativeTownData
$nativeTownArguments = @('--rendering-method', 'forward_plus', '--path', $nativeTownProject, 'res://town.tscn', '--', '--native-services', '--no-ai', '--db', (Join-Path $nativeTownData 'game.sqlite'), '--prefs', (Join-Path $nativeTownData 'settings.json'))
if ($SceneSeed) { $nativeTownArguments += '--scene-seed' }
Write-Output "Starting the native Godot town. Game data: $nativeTownData"
& $nativeTownEngine @nativeTownArguments
exit $LASTEXITCODE
