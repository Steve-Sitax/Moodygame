param([string]$Godot, [Parameter(Mandatory)][string]$Views, [string]$Candidate, [switch]$Measure, [switch]$Raw, [string]$Probe, [string]$Hide, [string]$Pick, [string]$Output, [ValidateRange(8900,9239)][int]$Port=9233, [int]$LimitSeconds=1500)
# Issue #157: pictures (day, rain, night) and frame times of town-house corner stones and door surrounds in the real
# native town (disposable save, no AI). -Candidate builds repaired meshes in memory; no resource file is written.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspace=Split-Path $project
if(-not $Output){$Output=Join-Path $workspace ('.scratch/stone-corners-'+[guid]::NewGuid().ToString('N'))}
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
    $arguments=@('--rendering-method','forward_plus','--audio-driver','Dummy','--path',$project,'--log-file',(Join-Path $proof 'live.log'),'res://town.tscn','--','--no-ai','--port',"$Port",'--db',(Join-Path $proof 'game.sqlite'),'--prefs',(Join-Path $proof 'settings.json'),'--author-root',(Join-Path $proof 'layouts'),'--stone-corners-proof',$proof,'--stone-corners-views',[IO.Path]::GetFullPath($Views))
    if($Candidate){$arguments+=@('--stone-corners-candidate',[IO.Path]::GetFullPath($Candidate))}
    if($Measure){$arguments+='--stone-corners-measure'}
    if($Raw){$arguments+='--stone-corners-raw'}
    if($Probe){$arguments+=@('--stone-corners-probe',$Probe)}
    if($Hide){$arguments+=@('--stone-corners-hide',$Hide)}
    if($Pick){$arguments+=@('--stone-corners-pick',$Pick)}
    Invoke-WorkshopEngine -Engine $engine -Project $project -EngineArguments $arguments -Log (Join-Path $proof 'engine.log') -LimitSeconds $LimitSeconds
    if(Test-Path -LiteralPath (Join-Path $proof 'failure.txt')){throw ('Stone corners proof failed: '+(Get-Content -LiteralPath (Join-Path $proof 'failure.txt') -Raw))}
    Write-Output "PROOF: $proof"
} finally {
    $env:SCHELDEMIST_USER_DATA=$previous; $env:SCHELDEMIST_TOWN_SEED=$previousSeed
    foreach($name in @('userdata','layouts','settings.json','game.sqlite','game.sqlite-shm','game.sqlite-wal')){
        $target=[IO.Path]::GetFullPath((Join-Path $proof $name))
        if(-not $target.StartsWith($proof+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Cleanup escaped proof'}
        if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse -Force}
    }
}
