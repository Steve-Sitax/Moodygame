param([string]$Godot, [string]$Output, [switch]$SkipBuild)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$proof=if($Output){[IO.Path]::GetFullPath($Output)}else{Join-Path (Split-Path $project) ('.scratch/ruien-cuts-'+[guid]::NewGuid().ToString('N'))}
if(Test-Path -LiteralPath $proof){throw 'Use a fresh proof folder.'}
[void](New-Item -ItemType Directory -Path $proof)
$previous=$env:SCHELDEMIST_USER_DATA
try {
    $env:SCHELDEMIST_USER_DATA=Join-Path $proof 'userdata'
    if(-not $SkipBuild){
        dotnet build (Join-Path $project 'Scheldemist.Native.csproj') --nologo -v quiet
        if($LASTEXITCODE -ne 0){throw 'Build failed'}
    }
    $arguments=@('--headless','--path',$project,'--log-file',(Join-Path $proof 'live.log'),'res://ruien-cut-proof.tscn','--','--no-ai',
        '--port','9184','--db',(Join-Path $proof 'game.sqlite'),'--prefs',(Join-Path $proof 'prefs.json'),
        '--author-root',(Join-Path $proof 'layouts'))
    Invoke-WorkshopEngine (Resolve-WorkshopGodot $Godot) $project $arguments (Join-Path $proof 'engine.log') 60
} finally { $env:SCHELDEMIST_USER_DATA=$previous }
