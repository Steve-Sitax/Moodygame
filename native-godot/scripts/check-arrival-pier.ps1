param([string]$Godot, [string]$Output, [ValidateRange(9140,9239)][int]$Port=9231, [int]$LimitSeconds=1500, [ValidateSet('','lamps')][string]$Only='')
# Plays the opening ferry in the real native town (disposable save, no AI) and keeps pictures of the Werf landing stage,
# its lanterns at night, in fog, in rain and by day (-Only lamps stops there), its tidal bridge and the ferry's gangway at three tides, while she moors, is left and sails. Output: arrival-pier.json.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspace=Split-Path $project
if(-not $Output){$Output=Join-Path $workspace ('.scratch/arrival-pier-'+[guid]::NewGuid().ToString('N'))}
$proof=[IO.Path]::GetFullPath($Output)
[void](New-Item -ItemType Directory -Path $proof -Force)
$engine=Resolve-WorkshopGodot $Godot
$previous=$env:SCHELDEMIST_USER_DATA
$previousSeed=$env:SCHELDEMIST_TOWN_SEED
try {
    $env:SCHELDEMIST_USER_DATA=Join-Path $proof 'userdata'; $env:SCHELDEMIST_TOWN_SEED='1873'
    & dotnet build (Join-Path $project 'Scheldemist.Native.csproj') --nologo -v quiet
    if($LASTEXITCODE -ne 0){throw 'Build failed'}
    Update-WorkshopImports $engine $project
    $arguments=@('--rendering-method','forward_plus','--audio-driver','Dummy','--path',$project,'--log-file',(Join-Path $proof 'live.log'),'res://town.tscn','--','--no-ai','--port',"$Port",'--db',(Join-Path $proof 'game.sqlite'),'--prefs',(Join-Path $proof 'settings.json'),'--author-root',(Join-Path $proof 'layouts'),'--arrival-pier-proof',$proof)
    if($Only){$arguments+=@('--arrival-pier-only',$Only)}
    Invoke-WorkshopEngine -Engine $engine -Project $project -EngineArguments $arguments -Log (Join-Path $proof 'engine.log') -LimitSeconds $LimitSeconds
    if(Test-Path -LiteralPath (Join-Path $proof 'failure.txt')){throw ('Arrival pier proof failed: '+(Get-Content -LiteralPath (Join-Path $proof 'failure.txt') -Raw))}
    Write-Output "PROOF: $proof"
} finally {
    $env:SCHELDEMIST_USER_DATA=$previous; $env:SCHELDEMIST_TOWN_SEED=$previousSeed
    foreach($name in @('userdata','layouts','settings.json','game.sqlite','game.sqlite-shm','game.sqlite-wal')){
        $target=[IO.Path]::GetFullPath((Join-Path $proof $name))
        if(-not $target.StartsWith($proof+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Cleanup escaped proof'}
        if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse -Force}
    }
}
