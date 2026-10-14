param([string]$Godot,[int]$Port=9191,[string]$Output)
$ErrorActionPreference='Stop'
if($Port-lt9180-or$Port-gt9199){throw 'Furniture checks use ports 9180-9199.'}
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'));$repo=[IO.Path]::GetFullPath((Join-Path $project '..'))
$engine=Resolve-WorkshopGodot $Godot
$proof=if($Output){[IO.Path]::GetFullPath($Output)}else{Join-Path $repo ('.scratch/furniture-check-'+[Guid]::NewGuid().ToString('N'))}
[void](New-Item -ItemType Directory -Path $proof -Force)
$data=Join-Path $proof 'data';$layouts=Join-Path $proof 'layouts';$savedData=$env:SCHELDEMIST_USER_DATA
function Run-Furniture([string]$Scene,[string]$Name,[string[]]$UserArgs){
 $args=@('--rendering-method','forward_plus','--path',$project,'--resolution','1440x1000','--log-file',(Join-Path $proof ($Name+'.live.log')),$Scene,'--')+$UserArgs
 Invoke-WorkshopEngine -Engine $engine -Project $project -EngineArguments $args -Log (Join-Path $proof ($Name+'.log')) -LimitSeconds 420 | Out-Null
}
try{
 $env:SCHELDEMIST_USER_DATA=$data
 & dotnet build (Join-Path $project 'Scheldemist.Native.csproj') --nologo
 if($LASTEXITCODE-ne0){throw 'Native build failed.'}
 Update-WorkshopImports $engine $project
 & (Join-Path $PSScriptRoot 'prepare-native-package.ps1') -Project $project
 foreach($stage in @('write','reload')){
  Run-Furniture 'res://main.tscn' ('workshop-'+$stage) @('--district','room-tavern-ankere','--author-root',$layouts,'--furniture-proof',$proof,'--proof-stage',$stage)
  $report=Get-Content (Join-Path $proof ('workshop-'+$stage+'.json')) -Raw | ConvertFrom-Json
  if($report.error-or@($report.rows|Where-Object {-not$_.pass}).Count){throw "Furniture workshop $stage failed."}
  Write-Output "PASS workshop $stage`: $($report.rows.Count) checks"
 }
 Run-Furniture 'res://town.tscn' 'game' @('--no-ai','--no-mainmenu','--dev','--port',$Port.ToString(),'--db',(Join-Path $data 'game.sqlite'),'--prefs',(Join-Path $data 'settings.json'),'--author-root',$layouts,'--furniture-game-proof',$proof)
 $report=Get-Content (Join-Path $proof 'game.json') -Raw | ConvertFrom-Json
 if($report.error-or@($report.rows|Where-Object {-not$_.pass}).Count){throw 'Furniture game proof failed.'}
 Write-Output "PASS game: $($report.rows.Count) checks"
 Write-Output "Pictures and receipts: $proof"
}finally{
 $env:SCHELDEMIST_USER_DATA=$savedData
 foreach($folder in @($data,$layouts)){
  $resolved=[IO.Path]::GetFullPath($folder)
  if(-not$resolved.StartsWith($proof+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Test cleanup escaped its isolated root.'}
  Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
 }
}
