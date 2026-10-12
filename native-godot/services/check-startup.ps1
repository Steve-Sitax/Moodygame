param()
$ErrorActionPreference='Stop'
$startupWorkspace=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$startupFolder=Join-Path $startupWorkspace ('.scratch\native-startup-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $startupFolder | Out-Null
$startupSources=[System.Security.SecurityElement]::Escape((Join-Path $startupWorkspace 'native-godot/src/Services').Replace('\','/'))
$startupProject=@"
<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable><UseSharedCompilation>false</UseSharedCompilation></PropertyGroup><ItemGroup><PackageReference Include="Microsoft.Data.Sqlite" Version="8.0.30" /><Compile Include="$startupSources/NativeCore*.cs" /><Compile Include="$startupSources/NativeService*.cs" /><Compile Include="$startupSources/NativeGoods.cs" /><Compile Include="$startupSources/NativePress.cs" /><Compile Include="$startupSources/NativePress.*.cs" /></ItemGroup></Project>
"@
Set-Content -LiteralPath (Join-Path $startupFolder 'StartupProof.csproj') -Value $startupProject -Encoding utf8
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'proof/StartupProof.cs.txt') -Destination (Join-Path $startupFolder 'Program.cs')
& dotnet run --project (Join-Path $startupFolder 'StartupProof.csproj') -- $startupWorkspace
if($LASTEXITCODE -ne 0){throw 'Native startup ordering proof failed.'}
