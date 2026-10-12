param([string]$Godot, [switch]$Editor, [string]$District = 'rijnkaai-recovered', [switch]$Fresh)
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
if ($Editor) {
    $workshopArguments += @('--editor', "res://recovered/$District/district.tscn")
} else {
    $workshopArguments += @('--', '--district', $District)
    if ($Fresh) {
        $workshopPreview = Join-Path $workshopProject ('proof\editor-preview-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $workshopPreview | Out-Null
        $workshopArguments += @('--author-dir', $workshopPreview)
    }
}
& $Godot @workshopArguments
exit $LASTEXITCODE
