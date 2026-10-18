param([string]$Godot, [ValidateRange(8800,9239)][int]$Port=9220, [ValidateSet('jef','menu','inventory','ladder')][string]$Mode='jef', [switch]$WithoutArms)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspace=Split-Path $project
$proof=Join-Path $workspace ('.scratch/jef-'+$Mode+'-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $proof)
$engine=Resolve-WorkshopGodot $Godot
$previous=$env:SCHELDEMIST_USER_DATA
$previousSeed=$env:SCHELDEMIST_TOWN_SEED
try {
    $env:SCHELDEMIST_USER_DATA=Join-Path $proof 'userdata'; $env:SCHELDEMIST_TOWN_SEED='1873'
    & (Join-Path $PSScriptRoot 'prepare-native-package.ps1') -Project $project
    & dotnet build (Join-Path $project 'Scheldemist.Native.csproj') --nologo -v quiet
    if($LASTEXITCODE -ne 0){throw 'Build failed'}
    Update-WorkshopImports $engine $project
    $arguments=@('--rendering-method','forward_plus','--path',$project,'--log-file',(Join-Path $proof 'live.log'),'res://town.tscn','--','--no-ai','--dev','--port',"$Port",'--db',(Join-Path $proof 'game.sqlite'),'--prefs',(Join-Path $proof 'settings.json'),'--author-root',(Join-Path $proof 'layouts'))
    if($Mode -ne 'menu'){$arguments+=@('--no-mainmenu','--native-pack-test')}
    if($WithoutArms){$arguments+='--no-arms'}
    switch($Mode){
        'jef' {$arguments+=@('--jef-proof',$proof)}
        'menu' {$arguments+=@('--menutest',$proof)}
        'inventory' {$arguments+=@('--jef-proof',$proof,'--jef-inventory')}
        'ladder' {$arguments+=@('--jef-proof',$proof,'--jef-ladder')}
    }
    Invoke-WorkshopEngine -Engine $engine -Project $project -EngineArguments $arguments -Log (Join-Path $proof 'engine.log') -LimitSeconds 720
    $reportFile=switch($Mode){'jef'{'jef.json'} 'ladder'{'jef.json'} 'menu'{'menutest.json'} 'inventory'{'inventory.json'}}
    $report=Get-Content -LiteralPath (Join-Path $proof $reportFile) -Raw | ConvertFrom-Json -AsHashtable
    if($Mode -in 'jef','ladder' -and -not $report.ok){throw 'Jef proof report failed'}
    if($Mode -eq 'menu' -and ($report.ok -eq $false -or $report.passed -eq $false)){throw 'Menu proof report failed'}
    Write-Output "PROOF: $proof"
} finally {
    $env:SCHELDEMIST_USER_DATA=$previous; $env:SCHELDEMIST_TOWN_SEED=$previousSeed
    foreach($name in @('userdata','layouts','settings.json','game.sqlite','game.sqlite-shm','game.sqlite-wal')){
        $target=[IO.Path]::GetFullPath((Join-Path $proof $name))
        if(-not $target.StartsWith($proof+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Cleanup escaped proof'}
        if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse -Force}
    }
}
