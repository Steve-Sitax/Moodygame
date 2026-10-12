param([string]$Godot,[string]$Output,[switch]$Server,[switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$engine = Resolve-WorkshopGodot $Godot
$templates = Join-Path $env:APPDATA 'Godot/export_templates/4.7.2.stable.mono'
foreach($name in @('windows_release_x86_64.exe','windows_release_x86_64_console.exe')) {
    if(-not (Test-Path -LiteralPath (Join-Path $templates $name))){throw "Install Godot 4.7.2 Mono templates. Missing $name"}
}
& (Join-Path $PSScriptRoot 'prepare-native-package.ps1') -Project $project
if($PrepareOnly){Write-Output "Package data and fingerprint prepared. Templates: $templates";return}
if((Get-Content -LiteralPath (Join-Path $project 'project.godot') -Raw) -notmatch 'run/main_scene="res://town.tscn"'){throw 'Set the native project main scene to res://town.tscn before release export.'}
if(-not $Output){$Output=Join-Path $project ('dist/windows-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')+$(if($Server){'-server'}))}
$Output=[IO.Path]::GetFullPath($Output)
if((Test-Path -LiteralPath $Output) -and @(Get-ChildItem -LiteralPath $Output -Force).Count){throw "Use an empty package output directory: $Output"}
[void](New-Item -ItemType Directory -Path $Output -Force)
$exe=if($Server){'ScheldemistServer.exe'}else{'Scheldemist.exe'}
$preset=if($Server){'Native Windows Server'}else{'Native Windows'}
$log=Join-Path $Output 'export.log'
Invoke-WorkshopEngine $engine $project @('--headless','--path',$project,'--export-release',$preset,(Join-Path $Output $exe)) $log 900 | Out-Null
if($Server){
    [IO.File]::WriteAllText((Join-Path $Output 'Start Server.cmd'),"@echo off`r`ncd /d `"%~dp0`"`r`nScheldemistServer.console.exe --headless -- --dedicated %*`r`n")
    [IO.File]::WriteAllText((Join-Path $Output 'README.txt'),"Scheldemist native Godot dedicated server.`r`nRun Start Server.cmd. Optional: --port 8800`r`nNo Node, browser, Godot editor or .NET installation is needed. Keep every file in this folder together.`r`n")
}else{
    [IO.File]::WriteAllText((Join-Path $Output 'Play Scheldemist.cmd'),"@echo off`r`ncd /d `"%~dp0`"`r`nstart `"Scheldemist`" `"%~dp0Scheldemist.exe`" --rendering-method forward_plus -- %*`r`n")
    [IO.File]::WriteAllText((Join-Path $Output 'README.txt'),"Scheldemist native Godot game.`r`nRun Play Scheldemist.cmd. Keep every file in this folder together.`r`nNo Node, browser, Godot editor or .NET installation is needed.`r`n")
}
$repository=[IO.Path]::GetFullPath((Join-Path $project '..'))
Copy-Item -LiteralPath (Join-Path $repository 'LICENSE') -Destination (Join-Path $Output 'LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $repository 'assets/ATTRIBUTION.md') -Destination (Join-Path $Output 'ATTRIBUTION.md')
[IO.File]::AppendAllText((Join-Path $Output 'README.txt'),"Licence: GNU AGPL version 3 or later; see LICENSE.txt. Third-party credits: ATTRIBUTION.md.`r`nSource project: https://github.com/Steve-Sitax/Moodygame (use the matching native source version when distributing a changed build).`r`n")
$receipt=& (Join-Path $PSScriptRoot 'verify-native-package.ps1') -Package $Output -Executable $exe
[IO.File]::WriteAllText((Join-Path $Output 'package-verification.json'),[string]$receipt)
$receipt
Write-Output "Package ready: $Output"
