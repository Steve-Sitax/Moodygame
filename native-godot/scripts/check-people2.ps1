param(
    [string]$Godot,
    # Comma lists are normalized below for pwsh -File.
    [string[]]$Modes = @('captures','shaders','parade','timing','identity','pack','network'),
    [ValidateRange(8800,9239)][int]$Port = 8980,
    [ValidateRange(0,3600)][int]$WaitForTimingSeconds = 900,
    [switch]$AllowSharedTiming,
    [string[]]$Extra = @()
)
$ErrorActionPreference = 'Stop'
$Modes = @($Modes | ForEach-Object { $_.Split(',') })
$allowed = @('captures','batch2-captures','integration-captures','crowd-captures','motion','work','dress-captures','distance-captures','routing','shaders','parade','timing','legacy-timing','identity','pack','network')
if ($Modes.Count -eq 1 -and $Modes[0] -eq 'all') { $Modes = $allowed }
foreach ($mode in $Modes) { if ($mode -notin $allowed) { throw "Unknown people2 mode: $mode" } }
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspace = [IO.Path]::GetFullPath((Join-Path $project '..'))
$scratch = Join-Path $workspace '.scratch'
$proof = Join-Path $scratch ('people2-native-' + [guid]::NewGuid().ToString('N'))
$engine = Resolve-WorkshopGodot $Godot
$rig = Get-Content (Join-Path $project 'world/data/shared/peopleRig.json') -Raw | ConvertFrom-Json -AsHashtable
$expectedRoots = $rig.bodies.Count + $rig.kinds.Count
& (Join-Path $PSScriptRoot 'prepare-native-package.ps1') -Project $project
& dotnet build (Join-Path $project 'Scheldemist.Native.csproj') --nologo -v quiet
if ($LASTEXITCODE -ne 0) { throw 'Native people2 build failed.' }
Update-WorkshopImports $engine $project
[void](New-Item -ItemType Directory -Path $proof)
$previousData = $env:SCHELDEMIST_USER_DATA
$previousSeed = $env:SCHELDEMIST_TOWN_SEED
function Remove-ProofData([string]$Path) {
    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not $resolved.StartsWith($proof + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Test cleanup escaped its proof directory.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
function Other-Godot([int]$OwnId = 0) {
    # The Windows console launcher starts the actual engine as a child process.
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
        Write-Output "People2 $mode proof: $dir"
        if ($mode -in @('identity','pack')) {
            & (Join-Path $PSScriptRoot $(if($mode -eq 'identity'){'check-native-content-identity.ps1'}else{'check-native-pack.ps1'})) -Project $project -Output $dir
            foreach ($item in Get-ChildItem -LiteralPath $dir -Force) {
                if ($item.Name -ne 'result.json') { Remove-ProofData $item.FullName }
            }
            continue
        }
        $env:SCHELDEMIST_USER_DATA = Join-Path $dir 'userdata'
        $args = @('--rendering-method','forward_plus','--path',$project,'--log-file',(Join-Path $dir 'live.log'))
        if ($mode -eq 'network') { $args += '--headless' }
        $args += @('res://town.tscn','--','--no-ai','--no-mainmenu','--dev','--port',$Port.ToString(),'--db',(Join-Path $dir 'game.sqlite'),'--prefs',(Join-Path $dir 'settings.json'),'--author-root',(Join-Path $dir 'layouts'),'--native-pack-test')
        if ($mode -eq 'legacy-timing') { $args += @('--people2','off') }
        $args += $Extra
        switch ($mode) {
            'batch2-captures' { $args += @('--people2-batch2-captures',$dir) }
            'captures' { $args += @('--people2-captures',$dir,'--people2-light-proof','--people2-picture-proof') }
            'integration-captures' { $args += @('--people2-captures',$dir,'--people2-light-proof','--people2-picture-proof','--people2-integration-proof') }
            'distance-captures' { $args += @('--people2-captures',$dir,'--people2-light-proof','--people2-picture-proof','--people2-distance-proof') }
            'dress-captures' { $args += @('--people2-captures',$dir,'--people2-light-proof','--people2-dress-proof') }
            'crowd-captures' { $args += @('--people2-captures',$dir,'--people2-light-proof','--people2-crowd-proof') }
            'motion' { $args += @('--people2-motion',$dir,'--people2-motion-bench','-3,313') }
            'work' { $args += @('--people2-work',$dir,'--people2-map','docker_b=docker_a,docker_c=docker_a,docker_sack=docker_a,fishwife_b=fishwife_a') }
            'routing' { $args += @('--people2-proof','--snap',$dir,'--views','routing:-118,1.6,30,180,0,13,clear','--people2-map','docker_a=man_middling,fishwife_a=woman_stout,police=man_stout,sooi=man_slight') }
            'shaders' { $args += @('--shaders',$dir) }
            'parade' { $args += @('--parade',$dir,'--parade-rows','blend_walk,idle,walk,talk') }
            {$_ -in @('timing','legacy-timing')} { $args += @('--peopletest',$dir,'--peoplechecks','crowds','--hour','13') }
            'network' { $args += @('--dedicated','--native-network-smoke',$dir) }
        }
        $timing = $mode -in @('timing','legacy-timing')
        # The in-game sampler owns PERF-LOCK and records windows during its measurement, after warmup.
        # Do not wait for or ask to close a player's window; shader identity is not a timing measurement.
        if ($timing) {
            tasklist /FI "IMAGENAME eq Godot*" | Set-Content -LiteralPath (Join-Path $dir 'tasklist-before.txt')
        }
        $start = [Diagnostics.ProcessStartInfo]::new($engine)
        $start.WorkingDirectory = $project; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
        $start.WindowStyle = if($mode -eq 'network'){[Diagnostics.ProcessWindowStyle]::Hidden}else{[Diagnostics.ProcessWindowStyle]::Normal}
        $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
        foreach ($arg in $args) { $start.ArgumentList.Add($arg) }
        $child = [Diagnostics.Process]::new(); $child.StartInfo = $start
        $isolation = [Collections.Generic.List[object]]::new()
        $limit = if ($mode -in @('captures','batch2-captures','integration-captures','distance-captures','dress-captures')) { 1200 } else { 420 }
        if($timing){$limit+=1200} # the in-game PERF-LOCK wait is separate from execution
        if ($mode -in @('captures','distance-captures')) { $limit *= [Math]::Ceiling($expectedRoots / 26.0) }
        if ($mode -eq 'integration-captures') { $limit *= [Math]::Ceiling($expectedRoots / 26.0) }
        try {
            [void]$child.Start()
            $stdout = $child.StandardOutput.ReadToEndAsync(); $stderr = $child.StandardError.ReadToEndAsync()
            $deadline = [DateTime]::UtcNow.AddSeconds($limit)
            $contaminated = $false
            while (-not $child.WaitForExit(1000)) {
                if ([DateTime]::UtcNow -gt $deadline) { $child.Kill($true); $child.WaitForExit(); throw "People2 $mode exceeded $limit seconds." }
                if ($timing) {
                    $others = @(Other-Godot $child.Id)
                    $isolation.Add(@{at=[DateTime]::UtcNow.ToString('O');pid=$child.Id;others=$others})
                    if ($others.Count) { $contaminated = $true }
                }
            }
            $log = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()
            [IO.File]::WriteAllText((Join-Path $dir 'engine.log'),$log)
            if ($timing) { $isolation | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $dir 'process-isolation.json') }
            if ($contaminated) { Write-Output 'Other Godot processes were observed during startup or sampling; peopletest.json records the authoritative isolation of each locked measurement.' }
            if ($child.ExitCode -ne 0 -or $log -match '(?m)^ERROR:') { throw "People2 $mode failed; inspect $dir/engine.log" }
            $reportFile = switch ($mode) { {$_ -in @('captures','batch2-captures','integration-captures','dress-captures','distance-captures','crowd-captures')} {'captures.json'} 'motion' {'motion.json'} 'work' {'work.json'} 'routing' {'people2-proof.json'} 'shaders' {'shaders.json'} 'parade' {'parade.json'} 'network' {'network.json'} default {'peopletest.json'} }
            $report = Get-Content -LiteralPath (Join-Path $dir $reportFile) -Raw | ConvertFrom-Json
            if ($mode -eq 'shaders' -and (-not $report.baselineMatched -or $report.people2ShaderKindCount -ne 1 -or -not $report.ok -or $report.problems.Count)) { throw 'Shader inventory must match assets/shader-baseline.json, keep exactly one people2 kind, and have zero problems.' }
            if ($mode -in @('captures','batch2-captures','integration-captures','crowd-captures','motion','work','dress-captures','distance-captures','timing','legacy-timing') -and -not $report.ok) { throw "People2 $mode report failed." }
            if ($mode -eq 'network' -and -not $report.passed) { throw 'Native multiplayer identity proof failed.' }
            if ($mode -eq 'routing' -and (-not $report.switchOkay -or -not $report.faceSetter.ok -or $report.bodyHeights.Count -ne $expectedRoots -or $report.figures[0].body -ne 'man_middling' -or $report.figures[1].body -ne 'woman_stout' -or $report.figures[2].body -ne 'man_stout' -or $report.figures[3].body -ne 'man_slight')) { throw 'People2 map/body/toggle proof failed.' }
            Write-Output "PASS $mode"
        } finally {
            if ($child.Id -and -not $child.HasExited) { $child.Kill($true); $child.WaitForExit() }
            $child.Dispose()
            foreach ($name in @('userdata','layouts','saves')) { Remove-ProofData (Join-Path $dir $name) }
            foreach ($file in Get-ChildItem -LiteralPath $dir -File | Where-Object { $_.Name -like 'game.*' -or $_.Name -like 'settings*' }) { Remove-ProofData $file.FullName }
        }
    }
} finally { $env:SCHELDEMIST_USER_DATA = $previousData; $env:SCHELDEMIST_TOWN_SEED = $previousSeed }
Write-Output "People2 evidence: $proof"
