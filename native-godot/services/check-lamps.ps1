param([switch]$RefreshLegacyOracles,[switch]$Staged)
$ErrorActionPreference='Stop'
if($RefreshLegacyOracles){throw 'Original-source regeneration is retired. Use the retained fixtures; historical capture scripts are in docs/archive/legacy-oracle-tools.'}
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if($RefreshLegacyOracles){& node (Join-Path $PSScriptRoot 'lamps-oracles.mts');if($LASTEXITCODE -ne 0){throw 'Original lamps oracle failed.'}}
$folder=Join-Path $workspace ('.scratch\native-lamps-proof-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$sources=[System.Security.SecurityElement]::Escape((Join-Path $workspace 'native-godot/src/Services').Replace('\','/'))
$project=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'proof/CoreProof.csproj.in') -Raw
$project=$project.Replace('../../native-godot/src/Services',$sources)
if($Staged){Copy-Item -LiteralPath (Join-Path $workspace 'native-godot/src/Services/NativeLampJobs.cs.txt') -Destination (Join-Path $folder 'NativeLampJobs.cs')}
else{$project=$project.Replace('</Project>','<ItemGroup><Compile Include="'+$sources+'/NativeLampJobs.cs" /></ItemGroup></Project>')}
Set-Content -LiteralPath (Join-Path $folder 'LampsProof.csproj') -Value $project -Encoding utf8
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'proof/LampsProof.cs.txt') -Destination (Join-Path $folder 'Program.cs')
& dotnet run --project (Join-Path $folder 'LampsProof.csproj') -- $workspace
if($LASTEXITCODE -ne 0){throw 'Native lamp jobs proof failed.'}
