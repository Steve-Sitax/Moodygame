param([string]$Godot, [switch]$Editor)
$ErrorActionPreference = 'Stop'
$workshopProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $Godot) {
    $workshopPackages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    $Godot = Get-ChildItem -LiteralPath $workshopPackages -Directory -Filter 'GodotEngine.GodotEngine.Mono_*' |
        ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Recurse -File -Filter '*_console.exe' } |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Godot -or -not (Test-Path -LiteralPath $Godot)) { throw 'Pass -Godot with the real Godot Mono console executable.' }
& dotnet build $workshopProject --nologo
if ($LASTEXITCODE -ne 0) { throw 'Native Godot build failed.' }
$workshopArguments = @('--path', $workshopProject)
if ($Editor) { $workshopArguments += '--editor' }
& $Godot @workshopArguments
exit $LASTEXITCODE
