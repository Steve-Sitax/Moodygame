param([string]$Godot = '', [switch]$Proof)
$ErrorActionPreference = 'Stop'
$antigoonProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$antigoonEngine = Resolve-WorkshopGodot $Godot
& dotnet build (Join-Path $antigoonProject 'Scheldemist.Native.csproj') -v quiet
if ($LASTEXITCODE -ne 0) { throw 'Build failed; the test was not started.' }
if ($Proof) {
    $antigoonLog = Join-Path $antigoonProject '../art-source/characters/antigoon/logs/scene-proof.log'
    Invoke-WorkshopEngine -Engine $antigoonEngine -Project $antigoonProject -EngineArguments @('--headless','--path',$antigoonProject,'res://antigoon-test.tscn','--','--antigoon-proof') -Log $antigoonLog -LimitSeconds 55
} else {
    # Interactive game requested by running this launcher. It uses no town database.
    & $antigoonEngine --path $antigoonProject 'res://antigoon-test.tscn'
}
