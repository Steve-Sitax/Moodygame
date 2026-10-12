param([string]$Godot,[string]$DataDirectory,[int]$Port=8800,[switch]$EnableAI)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$engine=Resolve-WorkshopGodot $Godot
if($Port -lt 1024 -or $Port -gt 65535){throw 'Server port must be from 1024 to 65535.'}
& (Join-Path $PSScriptRoot 'prepare-native-package.ps1') -Project $project
& dotnet build (Join-Path $project 'Scheldemist.Native.csproj') --nologo
if($LASTEXITCODE -ne 0){throw 'Native server build failed.'}
if(-not $DataDirectory){$DataDirectory=Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'ScheldemistWorkshop/native-server'}
$data=[IO.Path]::GetFullPath($DataDirectory)
[void](New-Item -ItemType Directory -Path $data -Force)
$env:SCHELDEMIST_USER_DATA=$data
$arguments=@('--headless','--path',$project,'res://town.tscn','--','--dedicated','--port',$Port.ToString())
if(-not $EnableAI){$arguments+='--no-ai'}
Write-Output "Starting the native Godot dedicated server on port $Port. Server data: $data"
& $engine @arguments
exit $LASTEXITCODE
