param(
    [string]$Source = 'D:\Code\MoodyGame-godot\godot\baked\next\town.glb',
    [string]$Plan = 'res://recovery/rijnkaai.json',
    [string]$Godot
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$recoveryProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$recoveryEngine = Resolve-WorkshopGodot $Godot
$recoveryEvidence = Join-Path $recoveryProject ('proof\recovery-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $recoveryEvidence | Out-Null
Set-Content -LiteralPath (Join-Path $recoveryProject 'proof\.gdignore') -Value ''
& dotnet build $recoveryProject --nologo
if ($LASTEXITCODE -ne 0) { throw 'Native Godot build failed.' }
Invoke-WorkshopEngine $recoveryEngine $recoveryProject @('--headless', '--editor', '--path', $recoveryProject, '--import', '--quit') (Join-Path $recoveryEvidence 'import-before.log')
Invoke-WorkshopEngine $recoveryEngine $recoveryProject @('--headless', '--path', $recoveryProject, 'res://recovery/recover.tscn', '--', '--source', $Source, '--plan', $Plan) (Join-Path $recoveryEvidence 'recover.log') 120
Invoke-WorkshopEngine $recoveryEngine $recoveryProject @('--headless', '--editor', '--path', $recoveryProject, '--import', '--quit') (Join-Path $recoveryEvidence 'import-after.log')
Write-Output "Recovery logs: $recoveryEvidence"
