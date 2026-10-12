param([switch]$RefreshLegacyOracles)
$ErrorActionPreference = 'Stop'
if($RefreshLegacyOracles){throw 'Original-source regeneration is retired. Use the retained fixtures; historical capture scripts are in docs/archive/legacy-oracle-tools.'}
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if ($RefreshLegacyOracles) {
    & node (Join-Path $PSScriptRoot 'core-oracles.mts') (Join-Path $PSScriptRoot 'proof\core-oracles.json')
    if ($LASTEXITCODE -ne 0) { throw 'Legacy rule oracle recovery failed.' }
}
$testFolder = Join-Path $workspace ('.scratch\native-core-proof-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testFolder -Force | Out-Null
$nativeSources = [System.Security.SecurityElement]::Escape((Join-Path $workspace 'native-godot\src\Services'))
$project = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'proof\CoreProof.csproj.in') -Raw
$project = $project.Replace('../../native-godot/src/Services', $nativeSources.Replace('\', '/'))
Set-Content -LiteralPath (Join-Path $testFolder 'CoreProof.csproj') -Value $project -Encoding utf8
$program = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'proof\CoreProof.cs.txt') -Raw
$program = $program.Replace('native-godot/proof/core-oracles.json', 'native-godot/services/proof/core-oracles.json')
Set-Content -LiteralPath (Join-Path $testFolder 'Program.cs') -Value $program -Encoding utf8
& dotnet run --project (Join-Path $testFolder 'CoreProof.csproj') -- $workspace
if ($LASTEXITCODE -ne 0) { throw 'Native service rule proof failed.' }
