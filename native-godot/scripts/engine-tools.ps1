function Resolve-WorkshopGodot([string]$Engine) {
    if ($Engine -and (Test-Path -LiteralPath $Engine)) { return $Engine }
    $enginePackages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    $Engine = Get-ChildItem -LiteralPath $enginePackages -Directory -Filter 'GodotEngine.GodotEngine.Mono_*' |
        ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Recurse -File -Filter '*_console.exe' } |
        Select-Object -First 1 -ExpandProperty FullName
    if (-not $Engine) { throw 'Pass -Godot with the real Godot Mono console executable.' }
    return $Engine
}

function Invoke-WorkshopEngine([string]$Engine, [string]$Project, [string[]]$EngineArguments, [string]$Log, [int]$LimitSeconds = 60) {
    $engineStart = [Diagnostics.ProcessStartInfo]::new()
    $engineStart.FileName = $Engine; $engineStart.WorkingDirectory = $Project
    $engineStart.UseShellExecute = $false; $engineStart.CreateNoWindow = $true
    # Hide console/headless helpers, but let a rendered proof create its actual game window.
    # SW_HIDE inherited by the engine can leave it minimized: FramePostDraw then never arrives.
    $engineStart.WindowStyle = if($EngineArguments -contains '--headless'){[Diagnostics.ProcessWindowStyle]::Hidden}else{[Diagnostics.ProcessWindowStyle]::Normal}
    $engineStart.RedirectStandardOutput = $true; $engineStart.RedirectStandardError = $true
    foreach ($argument in $EngineArguments) { $engineStart.ArgumentList.Add($argument) }
    $engineChild = [Diagnostics.Process]::new(); $engineChild.StartInfo = $engineStart
    try {
        [void]$engineChild.Start()
        $engineStdout = $engineChild.StandardOutput.ReadToEndAsync(); $engineStderr = $engineChild.StandardError.ReadToEndAsync()
        $engineTimedOut = -not $engineChild.WaitForExit($LimitSeconds * 1000)
        if ($engineTimedOut) { $engineChild.Kill($true); $engineChild.WaitForExit() }
        $engineText = $engineStdout.GetAwaiter().GetResult() + $engineStderr.GetAwaiter().GetResult()
        Set-Content -LiteralPath $Log -Value $engineText -Encoding utf8
        if ($engineTimedOut) { throw "Godot exceeded its $LimitSeconds-second limit. See $Log" }
        if ($engineChild.ExitCode -ne 0 -or $engineText -match '(?m)^ERROR:') {
            Write-Output (($engineText -split '\r?\n' | Select-Object -First 40) -join [Environment]::NewLine)
            throw "Godot failed. See $Log"
        }
        Write-Output $engineText.Trim()
    }
    finally { $engineChild.Dispose() }
}

# Godot's import cache (.godot/imported) is local and not in git. After a pull with new pictures or models the game
# would stop with "People2 picture failed to load". Import whatever is missing before launching (2026-10-14).
function Update-WorkshopImports([string]$Engine, [string]$Project, [int]$LimitSeconds = 1500) {
    $missing = @(Get-ChildItem -LiteralPath $Project -Recurse -File -Filter '*.import' |
        Where-Object { $_.FullName -notmatch '[\/]\.godot[\/]' } |
        ForEach-Object {
            foreach ($line in (Select-String -LiteralPath $_.FullName -Pattern '^dest_files=\[(.*)\]').Matches) {
                foreach ($dest in [regex]::Matches($line.Groups[1].Value, '"res://([^"]+)"')) {
                    if (-not (Test-Path -LiteralPath (Join-Path $Project $dest.Groups[1].Value))) { $_.FullName; break }
                }
            }
        } | Select-Object -Unique)
    if ($missing.Count -eq 0) { return }
    Write-Output "Importing $($missing.Count) new or changed pictures and models (first start after an update; this can take a few minutes)."
    $importStart = [Diagnostics.ProcessStartInfo]::new()
    $importStart.FileName = $Engine; $importStart.WorkingDirectory = $Project
    $importStart.UseShellExecute = $false; $importStart.CreateNoWindow = $true
    foreach ($argument in @('--path', $Project, '--rendering-method', 'forward_plus', '--import')) { $importStart.ArgumentList.Add($argument) }
    $importChild = [Diagnostics.Process]::Start($importStart)
    try {
        if (-not $importChild.WaitForExit($LimitSeconds * 1000)) { $importChild.Kill($true); throw "Godot's import exceeded $LimitSeconds seconds." }
    }
    finally { $importChild.Dispose() }
    $still = @($missing | Where-Object {
        $file = $_
        [regex]::Matches((Get-Content -LiteralPath $file -Raw), '"res://(\.godot/imported/[^"]+)"') |
            Where-Object { -not (Test-Path -LiteralPath (Join-Path $Project $_.Groups[1].Value)) }
    })
    if ($still.Count) { throw "Godot could not import: $($still -join ', ')" }
}
