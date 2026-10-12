param([switch]$RefreshLegacyOracles,[switch]$Staged)
$ErrorActionPreference='Stop'
if($RefreshLegacyOracles){throw 'Original-source regeneration is retired. Use the retained fixtures; historical capture scripts are in docs/archive/legacy-oracle-tools.'}
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if($RefreshLegacyOracles){ & node (Join-Path $PSScriptRoot 'ideas-oracles.mts');if($LASTEXITCODE -ne 0){throw 'Legacy ideas oracle failed.'} }
$folder=Join-Path $workspace ('.scratch\native-ideas-proof-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$sources=[System.Security.SecurityElement]::Escape((Join-Path $workspace 'native-godot\src\Services'))
$project=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'proof\CoreProof.csproj.in') -Raw
$project=$project.Replace('../../native-godot/src/Services',$sources.Replace('\','/'))
Set-Content -LiteralPath (Join-Path $folder 'IdeasProof.csproj') -Value $project -Encoding utf8
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'proof\IdeasProof.cs.txt') -Destination (Join-Path $folder 'Program.cs')
if($Staged){
 Get-ChildItem -LiteralPath (Join-Path $workspace 'native-godot\src\Services') -Filter 'NativeCoreIdeas*.cs.txt' | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $folder $_.Name.Replace('.cs.txt','.cs'))}
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'proof\IdeasExtras.cs.txt') -Destination (Join-Path $folder 'IdeasExtras.cs')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'proof\IdeasLifecycleProof.cs.txt') -Destination (Join-Path $folder 'IdeasLifecycleProof.cs')
$program=Get-Content -LiteralPath (Join-Path $folder 'Program.cs') -Raw
$program=$program.Replace('var report=new','count+=await IdeasExtras.Run(host,ideas,fixture,Check,Difference);var report=new')
$program=$program.Replace('var report=new','await IdeasLifecycleProof.Run(host,ideas,Check);var report=new')
Set-Content -LiteralPath (Join-Path $folder 'Program.cs') -Value $program -Encoding utf8
& dotnet run --project (Join-Path $folder 'IdeasProof.csproj') -- $workspace
if($LASTEXITCODE -ne 0){throw 'Native ideas proof failed.'}
