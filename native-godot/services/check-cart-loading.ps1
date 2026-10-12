$ErrorActionPreference='Stop'
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$folder=Join-Path $workspace ('.scratch/native-cart-loading-proof-'+[Guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path $folder | Out-Null
$source=[System.Security.SecurityElement]::Escape((Join-Path $workspace 'godot/src/Town/NativeCartLoadingPoint.cs').Replace('\','/'))
Set-Content -LiteralPath (Join-Path $folder 'Proof.csproj') -Value ('<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable><UseSharedCompilation>false</UseSharedCompilation></PropertyGroup><ItemGroup><Compile Include="'+$source+'" /></ItemGroup></Project>') -Encoding utf8
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'proof/CartLoadingProof.cs.txt') -Destination (Join-Path $folder 'Program.cs')
& dotnet run --project (Join-Path $folder 'Proof.csproj') -- $workspace
if($LASTEXITCODE -ne 0){throw 'Native cart loading point proof failed.'}
