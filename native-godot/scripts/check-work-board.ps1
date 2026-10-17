# Works the hiring board with mouse events in a disposable save with AI off (issue 152): hover, wheel, Esc, click,
# and one click after the quiet pause. Pictures and checks stay in .scratch.
param([string]$Godot, [ValidateRange(9140,9239)][int]$Port=9233)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspace=Split-Path $project
$proof=Join-Path $workspace ('.scratch/work-board-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
[void](New-Item -ItemType Directory -Path $proof)
$engine=Resolve-WorkshopGodot $Godot
$previous=$env:SCHELDEMIST_USER_DATA
$previousSeed=$env:SCHELDEMIST_TOWN_SEED
try {
    $env:SCHELDEMIST_USER_DATA=Join-Path $proof 'userdata'; $env:SCHELDEMIST_TOWN_SEED='1873'
    & dotnet build (Join-Path $project 'Scheldemist.Native.csproj') --nologo -v quiet
    if($LASTEXITCODE -ne 0){throw 'Build failed'}
    Update-WorkshopImports $engine $project
    $arguments=@('--rendering-method','forward_plus','--audio-driver','Dummy','--path',$project,'--log-file',(Join-Path $proof 'live.log'),'res://town.tscn','--','--no-ai','--dev','--port',"$Port",'--db',(Join-Path $proof 'game.sqlite'),'--prefs',(Join-Path $proof 'settings.json'),'--author-root',(Join-Path $proof 'layouts'),'--work-board-proof',$proof)
    Invoke-WorkshopEngine -Engine $engine -Project $project -EngineArguments $arguments -Log (Join-Path $proof 'engine.log') -LimitSeconds 900
    if(Test-Path -LiteralPath (Join-Path $proof 'failure.txt')){throw ('Work board proof failed: '+(Get-Content -LiteralPath (Join-Path $proof 'failure.txt') -Raw))}
    Write-Output "PROOF: $proof"
} finally {
    $env:SCHELDEMIST_USER_DATA=$previous; $env:SCHELDEMIST_TOWN_SEED=$previousSeed
    foreach($name in @('userdata','layouts','settings.json','game.sqlite','game.sqlite-shm','game.sqlite-wal')){
        $target=[IO.Path]::GetFullPath((Join-Path $proof $name))
        if(-not $target.StartsWith($proof+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Cleanup escaped proof'}
        if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse -Force}
    }
}
