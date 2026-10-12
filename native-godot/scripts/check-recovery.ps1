param([string]$Godot, [string]$District = 'rijnkaai-recovered')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$recoveryProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$recoveryEngine = Resolve-WorkshopGodot $Godot
$recoveryEvidence = Join-Path $recoveryProject ('proof\recovery-check-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $recoveryEvidence | Out-Null
Set-Content -LiteralPath (Join-Path $recoveryProject 'proof\.gdignore') -Value ''
& dotnet build $recoveryProject --nologo
if ($LASTEXITCODE -ne 0) { throw 'Native Godot build failed.' }
Invoke-WorkshopEngine $recoveryEngine $recoveryProject @('--headless', '--editor', '--path', $recoveryProject, '--import', '--quit') (Join-Path $recoveryEvidence 'import.log')
$recoveryFixture = Join-Path $recoveryEvidence 'fixture'
$recoveryFixtureId = 'recovery-fixture-' + [guid]::NewGuid().ToString('N')
Invoke-WorkshopEngine $recoveryEngine $recoveryProject @('--headless', '--path', $recoveryProject, 'res://recovery/recover.tscn', '--',
    '--fixture', $recoveryFixture, '--fixture-id', $recoveryFixtureId,
    '--source', (Join-Path $recoveryFixture 'fixture.glb'), '--plan', (Join-Path $recoveryFixture 'plan.json')) (Join-Path $recoveryEvidence 'fixture.log')
$recoveryFixtureReport = Get-Content -Raw -LiteralPath (Join-Path $recoveryProject "recovered\$recoveryFixtureId\recovery-report.json") | ConvertFrom-Json
if ($recoveryFixtureReport.copies -ne 1) { throw 'Fixture did not restore exactly one in-bound instance.' }
if ($recoveryFixtureReport.materials.Count -ne 1) { throw 'Fixture retained an unused material or invalid image.' }
foreach ($recoveryDistrict in @($recoveryFixtureId, $District)) {
    $recoveryLayout = Join-Path $recoveryEvidence $recoveryDistrict
    New-Item -ItemType Directory -Path $recoveryLayout | Out-Null
    foreach ($recoveryStage in @('write', 'reload')) {
        Invoke-WorkshopEngine $recoveryEngine $recoveryProject @('--headless', '--path', $recoveryProject, 'res://main.tscn', '--', '--district', $recoveryDistrict,
            '--author-dir', $recoveryLayout, '--recovery-test', $recoveryLayout, '--proof-stage', $recoveryStage) (Join-Path $recoveryLayout "$recoveryStage.log")
        $recoveryReport = Get-Content -Raw -LiteralPath (Join-Path $recoveryLayout "$recoveryStage.json") | ConvertFrom-Json
        if ($recoveryReport.error -or @($recoveryReport.rows | Where-Object { -not $_.pass }).Count -gt 0) { throw "$recoveryStage proof failed." }
        Write-Output ("PASS $recoveryDistrict $recoveryStage`: " + $recoveryReport.rows.Count + ' checks')
    }
}
Write-Output "Recovery evidence: $recoveryEvidence"
