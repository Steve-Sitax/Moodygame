$ErrorActionPreference='Stop'
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$compiled=Join-Path $workspace 'native-godot/.godot/mono/temp/bin/Debug'
$folder=Join-Path $workspace ('.scratch/native-adapter-proof-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $folder -Force|Out-Null
$refs=@('Scheldemist.Native','Scheldemist','GodotSharp')|ForEach-Object{'<Reference Include="'+$_+'"><HintPath>'+[System.Security.SecurityElement]::Escape((Join-Path $compiled ($_+'.dll')).Replace('\','/'))+'</HintPath></Reference>'}
$project='<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup><ItemGroup><PackageReference Include="Microsoft.Data.Sqlite" Version="8.0.30" />'+($refs -join '')+'</ItemGroup></Project>'
Set-Content -LiteralPath (Join-Path $folder 'Proof.csproj') -Value $project -Encoding utf8
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'proof/AdapterProof.cs.txt') -Destination (Join-Path $folder 'Program.cs')
& dotnet run --project (Join-Path $folder 'Proof.csproj') -- $workspace
if($LASTEXITCODE -ne 0){throw 'Native per-seat adapter proof failed.'}
