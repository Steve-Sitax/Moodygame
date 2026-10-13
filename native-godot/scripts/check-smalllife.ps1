param(
    [string]$Godot,
    [ValidateSet('captures','integration','trace','shaders','timing','identity','network')]
    [string[]]$Modes = @('captures','integration','trace','shaders','timing','identity','network'),
    # Native HTTPS uses Port+1; keep both listeners inside this helper's 8990-8999 range.
    [ValidateRange(8990,8998)][int]$Port = 8991,
    [ValidateRange(0,3600)][int]$WaitForTimingSeconds = 900,
    [ValidateRange(0,120)][int]$QuietSeconds = 30,
    [switch]$NoPrepare,
    [string[]]$Extra = @()
)
# Native smalllife proofs (docs/plans/people.md package H): isolated saves, settings, layouts and caches under
# .scratch/smalllife-native-*, AI off, every run bounded and its data deleted afterwards; logs, pictures and reports kept.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspace = [IO.Path]::GetFullPath((Join-Path $project '..'))
$scratch = Join-Path $workspace '.scratch'
$proof = Join-Path $scratch ('smalllife-native-' + [guid]::NewGuid().ToString('N'))
$engine = Resolve-WorkshopGodot $Godot
if (-not $NoPrepare) { & (Join-Path $PSScriptRoot 'prepare-native-package.ps1') -Project $project }
& dotnet build (Join-Path $project 'Scheldemist.Native.csproj') --nologo -v quiet
if ($LASTEXITCODE -ne 0) { throw 'Native build failed.' }
[void](New-Item -ItemType Directory -Path $proof)
$previousData = $env:SCHELDEMIST_USER_DATA
$previousSeed = $env:SCHELDEMIST_TOWN_SEED
function Remove-ProofData([string]$Path) {
    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not $resolved.StartsWith($proof + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Test cleanup escaped its proof directory.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
function Other-Godot([int]$OwnId = 0) {
    $processes = @(Get-CimInstance Win32_Process)
    $owned = [Collections.Generic.HashSet[int]]::new()
    if ($OwnId) { [void]$owned.Add($OwnId) }
    do {
        $changed = $false
        foreach ($process in $processes) {
            if ($owned.Contains([int]$process.ParentProcessId) -and $owned.Add([int]$process.ProcessId)) { $changed = $true }
        }
    } while ($changed)
    @($processes | Where-Object {
        if ($_.Name -notlike '*Godot*' -or $owned.Contains([int]$_.ProcessId)) { return $false }
        return $true
    } | Select-Object -ExpandProperty ProcessId)
}
try {
    $env:SCHELDEMIST_TOWN_SEED = '1873'
    foreach ($mode in $Modes) {
        $dir = Join-Path $proof $mode
        [void](New-Item -ItemType Directory -Path $dir)
        Write-Output "Small life $mode proof: $dir"
        if ($mode -eq 'identity') {
            & (Join-Path $PSScriptRoot 'check-native-content-identity.ps1') -Project $project -Output $dir
            foreach ($item in Get-ChildItem -LiteralPath $dir -Force) { if ($item.Name -ne 'result.json') { Remove-ProofData $item.FullName } }
            continue
        }
        $env:SCHELDEMIST_USER_DATA = Join-Path $dir 'userdata'
        $args = @('--rendering-method','forward_plus','--path',$project,'--log-file',(Join-Path $dir 'live.log'))
        if ($mode -eq 'network') { $args += '--headless' }
        $args += @('res://town.tscn','--','--no-ai','--no-mainmenu','--dev','--port',$Port.ToString(),'--db',(Join-Path $dir 'game.sqlite'),'--prefs',(Join-Path $dir 'settings.json'),'--author-root',(Join-Path $dir 'layouts'),'--native-pack-test')
        $args += $Extra
        switch ($mode) {
            'captures' { $args += @('--smalllife-captures',$dir) }
            'integration' { $args += @('--smalllife-integration',$dir) }
            'trace' { $args += @('--smalllife-trace',$dir) }
            'shaders' { $args += @('--shaders',$dir) }
            'timing' { $args += @('--peopletest',$dir,'--peoplechecks','crowds','--hour','13') }
            'network' { $args += @('--dedicated','--native-network-smoke',$dir) }
        }
        $timing = $mode -in @('timing','trace')
        if ($mode -eq 'trace') {
            # the trace times the smalllife' own update: run it alone when the other engines allow, else note who ran
            $until = [DateTime]::UtcNow.AddSeconds([Math]::Min($WaitForTimingSeconds, 300))
            while ((Other-Godot).Count -and [DateTime]::UtcNow -lt $until) { Start-Sleep -Seconds 2 }
            @(Other-Godot) | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dir 'others-at-start.json')
        }
        if ($timing) {
            $exclusiveUntil = [DateTime]::UtcNow.AddSeconds($WaitForTimingSeconds)
            $waiting = 0
            $quietSince = [DateTime]::UtcNow
            while ((Other-Godot).Count -or ([DateTime]::UtcNow-$quietSince).TotalSeconds -lt $QuietSeconds) {
                if ([DateTime]::UtcNow -ge $exclusiveUntil) { throw 'Exclusive timing requires all other Godot engines to finish.' }
                if ((Other-Godot).Count) { $quietSince = [DateTime]::UtcNow }
                if ($waiting++ % 30 -eq 0) { Write-Output 'Waiting for other Godot engines before exclusive timing.' }
                Start-Sleep -Seconds 1
            }
            tasklist /FI "IMAGENAME eq Godot*" | Set-Content -LiteralPath (Join-Path $dir 'tasklist-before.txt')
        }
        $start = [Diagnostics.ProcessStartInfo]::new($engine)
        $start.WorkingDirectory = $project; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
        $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
        $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
        foreach ($arg in $args) { $start.ArgumentList.Add($arg) }
        $child = [Diagnostics.Process]::new(); $child.StartInfo = $start
        $isolation = [Collections.Generic.List[object]]::new()
        $limit = if ($mode -eq 'captures') { 900 } else { 420 }
        try {
            [void]$child.Start()
            $stdout = $child.StandardOutput.ReadToEndAsync(); $stderr = $child.StandardError.ReadToEndAsync()
            $deadline = [DateTime]::UtcNow.AddSeconds($limit)
            $contaminated = $false
            while (-not $child.WaitForExit(1000)) {
                if ([DateTime]::UtcNow -gt $deadline) { $child.Kill($true); $child.WaitForExit(); throw "Small life $mode exceeded $limit seconds." }
                if ($timing) {
                    $others = @(Other-Godot $child.Id)
                    $isolation.Add(@{at=[DateTime]::UtcNow.ToString('O');pid=$child.Id;others=$others})
                    if ($others.Count) { $contaminated = $true }
                }
            }
            $log = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()
            [IO.File]::WriteAllText((Join-Path $dir 'engine.log'),$log)
            if ($timing) { $isolation | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $dir 'process-isolation.json') }
            if ($contaminated) { throw 'Timing contaminated by another Godot process.' }
            if ($child.ExitCode -ne 0 -or $log -match '(?m)^ERROR:') { throw "Small life $mode failed; inspect $dir/engine.log" }
            $reportFile = switch ($mode) { 'captures' {'smalllife-captures.json'} 'integration' {'smalllife-integration.json'} 'trace' {'smalllife-trace.json'} 'shaders' {'shaders.json'} 'network' {'network.json'} default {'peopletest.json'} }
            $report = Get-Content -LiteralPath (Join-Path $dir $reportFile) -Raw | ConvertFrom-Json
            if ($mode -eq 'shaders' -and (-not $report.ok -or $report.problems.Count -or $report.people2ShaderKindCount -ne 1)) { throw 'Shader inventory: a problem, or not exactly one people2 (skin) kind.' }
            if ($mode -in @('captures','integration','timing','trace') -and -not $report.ok) { throw "Small life $mode report failed." }
            if ($mode -eq 'network' -and -not $report.passed) { throw 'Native multiplayer identity proof failed.' }
            Write-Output "PASS $mode"
        } finally {
            if ($child.Id -and -not $child.HasExited) { $child.Kill($true); $child.WaitForExit() }
            $child.Dispose()
            foreach ($name in @('userdata','layouts','saves')) { Remove-ProofData (Join-Path $dir $name) }
            foreach ($file in Get-ChildItem -LiteralPath $dir -File | Where-Object { $_.Name -like 'game.*' -or $_.Name -like 'settings*' }) { Remove-ProofData $file.FullName }
        }
    }
} finally { $env:SCHELDEMIST_USER_DATA = $previousData; $env:SCHELDEMIST_TOWN_SEED = $previousSeed }
Write-Output "Small life evidence: $proof"
