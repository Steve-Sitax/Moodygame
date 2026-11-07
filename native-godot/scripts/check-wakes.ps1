param([string]$Godot, [string]$Output, [int]$Port=9231, [switch]$SkipEntranceCuts)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if(-not $Output){$Output=Join-Path (Split-Path $project) ('.scratch/wakes-'+[guid]::NewGuid().ToString('N'))}
$proof=[IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Force $proof | Out-Null
$previous=$env:SCHELDEMIST_USER_DATA
$previousSeed=$env:SCHELDEMIST_TOWN_SEED
try {
    $env:SCHELDEMIST_USER_DATA=Join-Path $proof 'userdata'
    $env:SCHELDEMIST_TOWN_SEED='1873'
    & dotnet build $project --nologo -v quiet
    if($LASTEXITCODE -ne 0){throw 'Build failed'}
    $engine=Resolve-WorkshopGodot $Godot
    $arguments=@('--rendering-method','forward_plus','--audio-driver','Dummy','--path',$project,
        '--log-file',(Join-Path $proof 'live.log'),'res://town.tscn','--','--no-ai','--port',"$Port",
        '--db',(Join-Path $proof 'game.sqlite'),'--prefs',(Join-Path $proof 'settings.json'),
        '--author-root',(Join-Path $proof 'layouts'),'--wake-proof',$proof)
    if($SkipEntranceCuts){$arguments+='--no-ruien-gates'}
    Invoke-WorkshopEngine -Engine $engine -Project $project -EngineArguments $arguments -Log (Join-Path $proof 'engine.log') -LimitSeconds 900
    if(Test-Path (Join-Path $proof 'failure.txt')){throw (Get-Content (Join-Path $proof 'failure.txt') -Raw)}
    if(@(Get-ChildItem $proof -Filter '*.png').Count -lt 18){throw 'Expected at least 18 wake captures'}
    Write-Output "Wake captures: $proof"
} finally {
    $env:SCHELDEMIST_USER_DATA=$previous
    $env:SCHELDEMIST_TOWN_SEED=$previousSeed
}
