param([Parameter(Mandatory)][string]$Output,[string]$Godot,[int]$Port=8925,[switch]$Multiplayer)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
if($Port -lt 8900 -or $Port -gt 65534){throw 'Choose an isolated test port of at least 8900 (the guest uses the next port).'}
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputPath=[IO.Path]::GetFullPath($Output)
if(Test-Path -LiteralPath $outputPath){throw 'Choose a fresh output directory; proof saves are never reused.'}
[void](New-Item -ItemType Directory -Path $outputPath)
& dotnet build (Join-Path $project 'Scheldemist.Native.csproj') --nologo -v quiet
if($LASTEXITCODE -ne 0){throw 'Conversation proof build failed.'}
$beforeData=$env:SCHELDEMIST_USER_DATA;$beforeSeed=$env:SCHELDEMIST_TOWN_SEED
try {
    $env:SCHELDEMIST_USER_DATA=Join-Path $outputPath 'userdata';$env:SCHELDEMIST_TOWN_SEED='1873'
    $arguments=@('--rendering-method','forward_plus','--audio-driver','Dummy','--path',$project,'--log-file',(Join-Path $outputPath 'live.log'),'res://town.tscn','--','--no-ai','--no-mainmenu','--port',$Port.ToString(),'--db',(Join-Path $outputPath 'game.sqlite'),'--prefs',(Join-Path $outputPath 'settings.json'),'--author-root',(Join-Path $outputPath 'layouts'))
    if($Multiplayer){$arguments+=@('--mptest',$outputPath,'--mpconversation')}else{$arguments+=@('--conversation-proof',$outputPath)}
    Invoke-WorkshopEngine -Engine (Resolve-WorkshopGodot $Godot) -Project $project -EngineArguments $arguments -Log (Join-Path $outputPath 'engine.log') -LimitSeconds 480 | Out-Null
    $file=if($Multiplayer){'mptest.json'}else{'conversation.json'}
    $result=Get-Content -LiteralPath (Join-Path $outputPath $file) -Raw|ConvertFrom-Json
    if($Multiplayer){if(-not $result.ok){throw 'Multiplayer conversation failed.'}}
    elseif($result.error -or @($result.checks|Where-Object {-not $_.pass}).Count){throw 'Conversation or room clearance failed.'}
    Write-Output ('PASS: '+(Join-Path $outputPath $file))
}finally{$env:SCHELDEMIST_USER_DATA=$beforeData;$env:SCHELDEMIST_TOWN_SEED=$beforeSeed}
