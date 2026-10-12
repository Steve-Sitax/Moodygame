param([string]$Godot)
$ErrorActionPreference = 'Stop'
$workshopProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $Godot) {
    $workshopPackages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    $Godot = Get-ChildItem -LiteralPath $workshopPackages -Directory -Filter 'GodotEngine.GodotEngine.Mono_*' |
        ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Recurse -File -Filter '*_console.exe' } |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Godot -or -not (Test-Path -LiteralPath $Godot)) { throw 'Pass -Godot with the real Godot Mono console executable.' }
$workshopProof = Join-Path $workshopProject ('proof\run-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workshopProof | Out-Null
Set-Content -LiteralPath (Join-Path $workshopProject 'proof\.gdignore') -Value ''

function Invoke-Workshop([string[]]$EngineArguments, [string]$Name) {
    $workshopStart = [Diagnostics.ProcessStartInfo]::new()
    $workshopStart.FileName = $Godot
    $workshopStart.WorkingDirectory = $workshopProject
    $workshopStart.UseShellExecute = $false
    $workshopStart.CreateNoWindow = $true
    $workshopStart.RedirectStandardOutput = $true
    $workshopStart.RedirectStandardError = $true
    foreach ($argument in $EngineArguments) { $workshopStart.ArgumentList.Add($argument) }
    $workshopChild = [Diagnostics.Process]::new()
    $workshopChild.StartInfo = $workshopStart
    try {
        [void]$workshopChild.Start()
        $workshopStdout = $workshopChild.StandardOutput.ReadToEndAsync()
        $workshopStderr = $workshopChild.StandardError.ReadToEndAsync()
        if (-not $workshopChild.WaitForExit(45000)) {
            $workshopChild.Kill($true)
            throw "$Name exceeded its 45-second limit."
        }
        $workshopText = $workshopStdout.GetAwaiter().GetResult() + $workshopStderr.GetAwaiter().GetResult()
        Set-Content -LiteralPath (Join-Path $workshopProof "$Name.log") -Value $workshopText -Encoding utf8
        if ($workshopChild.ExitCode -ne 0 -or $workshopText -match '(?m)^ERROR:') {
            Write-Output $workshopText
            throw "$Name failed. See $workshopProof"
        }
    }
    finally { $workshopChild.Dispose() }
}

& dotnet build $workshopProject --nologo
if ($LASTEXITCODE -ne 0) { throw 'Native Godot build failed.' }
Invoke-Workshop @('--headless', '--editor', '--path', $workshopProject, '--import', '--quit', '--log-file', (Join-Path $workshopProof 'engine-import.log')) 'import'
foreach ($workshopStage in @('write', 'reload')) {
    Invoke-Workshop @('--headless', '--path', $workshopProject, '--log-file', (Join-Path $workshopProof "engine-$workshopStage.log"), '--',
        '--author-dir', $workshopProof, '--author-test', $workshopProof, '--proof-stage', $workshopStage) $workshopStage
    $workshopReport = Get-Content -Raw -LiteralPath (Join-Path $workshopProof "$workshopStage.json") | ConvertFrom-Json
    if ($workshopReport.error -or @($workshopReport.rows | Where-Object { -not $_.pass }).Count -gt 0) { throw "$workshopStage proof failed." }
    Write-Output ("PASS $workshopStage`: " + $workshopReport.rows.Count + ' checks')
}
Write-Output "Evidence: $workshopProof"
