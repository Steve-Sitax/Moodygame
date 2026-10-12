param([string]$Godot, [int]$Port = 8913, [switch]$Dedicated)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$engine = Resolve-WorkshopGodot $Godot
# Prepare/build once before either client starts: both must use the same identity.
& (Join-Path $PSScriptRoot 'prepare-native-package.ps1') -Project $project
& dotnet build (Join-Path $project 'Scheldemist.Native.csproj') --nologo -v quiet
if ($LASTEXITCODE -ne 0) { throw 'Native multiplayer build failed.' }
$kind = if ($Dedicated) { 'native-network' } else { 'native-multiplayer' }
$proof = Join-Path $project ('proof/' + $kind + '-' + [Guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $proof)
$previousData = $env:SCHELDEMIST_USER_DATA
try {
    $env:SCHELDEMIST_USER_DATA = $proof
    $engineArgs = @('--path', $project, '--log-file', (Join-Path $proof 'live.log'))
    if ($Dedicated) { $engineArgs += '--headless' }
    $engineArgs += @('--', '--no-ai', '--port', $Port.ToString(), '--author-root', (Join-Path $proof 'layouts'), '--prefs', (Join-Path $proof 'settings.json'), '--native-registry', (Join-Path $proof 'registry.json'))
    if ($Dedicated) {
        $engineArgs += @('--dedicated', '--native-network-smoke', $proof, '--db', (Join-Path $proof 'game.sqlite'))
    } else {
        $engineArgs += @('--mptest', $proof, '--mpmoving')
    }
    Write-Output "Native multiplayer proof: $proof"
    Invoke-WorkshopEngine -Engine $engine -Project $project -EngineArguments $engineArgs -Log (Join-Path $proof 'engine.log') -LimitSeconds $(if ($Dedicated) { 120 } else { 420 }) | Out-Null
    $report = Get-Content -LiteralPath (Join-Path $proof $(if ($Dedicated) { 'network.json' } else { 'mptest.json' })) -Raw | ConvertFrom-Json
    $passed = if ($Dedicated) { $report.passed } else { $report.ok }
    if (-not $passed) { throw "Native multiplayer proof failed: $proof" }
    Write-Output "PASS: $proof"
} finally {
    $env:SCHELDEMIST_USER_DATA = $previousData
}
