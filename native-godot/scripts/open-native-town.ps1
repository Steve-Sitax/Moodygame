param([string]$Godot, [switch]$SceneSeed, [string]$DataDirectory, [int]$Port = 8800, [switch]$NoAI)
# AI is on at start (Steve, 2026-11-02): the player's own AI setup (Esc, AI setup) decides. -NoAI starts a walk-around test run.
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
$nativeTownArguments = @('--rendering-method', 'forward_plus', '--path', $nativeTownProject, 'res://town.tscn', '--', '--native-services', '--db', (Join-Path $nativeTownData 'game.sqlite'), '--prefs', (Join-Path $nativeTownData 'settings.json'))
$nativeTownArguments += @('--port', $Port.ToString())
if ($NoAI) { $nativeTownArguments += '--no-ai' }
if ($PSBoundParameters.ContainsKey('DataDirectory')) { $nativeTownArguments += @('--author-root', (Join-Path $nativeTownData 'layouts')) }
if ($SceneSeed) { $nativeTownArguments += '--scene-seed' }
Write-Output "Starting the native Godot town. Game data: $nativeTownData"
& $nativeTownEngine @nativeTownArguments
exit $LASTEXITCODE
