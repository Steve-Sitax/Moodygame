param([switch]$RefreshLegacyOracles,[switch]$Staged)
$ErrorActionPreference='Stop'
if($RefreshLegacyOracles){throw 'Original-source regeneration is retired. Use the retained fixtures; historical capture scripts are in docs/archive/legacy-oracle-tools.'}
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if($RefreshLegacyOracles){& node (Join-Path $PSScriptRoot 'mills-oracles.mts');if($LASTEXITCODE -ne 0){throw 'Original mills oracle failed.'}}
$folder=Join-Path $workspace ('.scratch\native-mills-proof-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$sources=[System.Security.SecurityElement]::Escape((Join-Path $workspace 'native-godot/src/Services').Replace('\','/'))
$project=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'proof/CoreProof.csproj.in') -Raw
$project=$project.Replace('../../native-godot/src/Services',$sources)
if($Staged){Get-ChildItem -LiteralPath (Join-Path $workspace 'native-godot/src/Services') -Filter 'NativeMills*.cs.txt' | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $folder $_.Name.Replace('.cs.txt','.cs'))}}
else{$project=$project.Replace('</Project>','<ItemGroup><Compile Include="'+$sources+'/NativeMills*.cs" /></ItemGroup></Project>')}
Set-Content -LiteralPath (Join-Path $folder 'MillsProof.csproj') -Value $project -Encoding utf8
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'proof/MillsProof.cs.txt') -Destination (Join-Path $folder 'Program.cs')
& dotnet run --project (Join-Path $folder 'MillsProof.csproj') -- $workspace
if($LASTEXITCODE -ne 0){throw 'Native mills proof failed.'}
