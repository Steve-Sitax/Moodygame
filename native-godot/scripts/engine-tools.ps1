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

# A kit rebuild can change UVs while its old cached textures still load successfully. Compare the source
# content with Godot's import receipt, not timestamps: git checkouts and copied caches can preserve either.
function Get-WorkshopStaleImports([string]$Project) {
    Get-ChildItem -LiteralPath $Project -Recurse -File -Filter '*.import' |
        Where-Object { $_.FullName -notmatch '[\\/]\.godot[\\/]' } |
        ForEach-Object {
            $importFile = $_.FullName
            $settings = Get-Content -LiteralPath $importFile -Raw
            $source = $importFile.Substring(0, $importFile.Length - '.import'.Length)
            # Retired/generated sources can leave orphan import settings in an existing checkout.
            if (-not (Test-Path -LiteralPath $source)) { return }
            $stale = $false
            foreach ($line in [regex]::Matches($settings, '(?m)^dest_files=\[(.*)\]')) {
                foreach ($dest in [regex]::Matches($line.Groups[1].Value, '"res://([^"]+)"')) {
                    $resource = Join-Path $Project $dest.Groups[1].Value
                    if (-not (Test-Path -LiteralPath $resource)) { $stale = $true; break }
                    if ($resource -notmatch '^(.*-[0-9a-f]{32})(?:\.[^\\/.]+)+$') { $stale = $true; break }
                    $receipt = $Matches[1] + '.md5'
                    if (-not (Test-Path -LiteralPath $receipt)) { $stale = $true; break }
                    $savedHash = [regex]::Match((Get-Content -LiteralPath $receipt -Raw), 'source_md5="([0-9a-f]{32})"')
                    $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm MD5).Hash
                    if (-not $savedHash.Success -or $savedHash.Groups[1].Value -ne $sourceHash) { $stale = $true; break }
                }
                if ($stale) { break }
            }
            if ($stale) { $importFile }
        } | Select-Object -Unique
}

function Update-WorkshopImports([string]$Engine, [string]$Project, [int]$LimitSeconds = 1500) {
    $stale = @(Get-WorkshopStaleImports $Project)
    if ($stale.Count -eq 0) { return }
    Write-Output "Importing $($stale.Count) new or changed pictures and models (first start after an update; this can take a few minutes)."
    $importStart = [Diagnostics.ProcessStartInfo]::new()
    $importStart.FileName = $Engine; $importStart.WorkingDirectory = $Project
    $importStart.UseShellExecute = $false; $importStart.CreateNoWindow = $true
    $importStart.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    foreach ($argument in @('--headless', '--path', $Project, '--rendering-method', 'forward_plus', '--import')) { $importStart.ArgumentList.Add($argument) }
    $importChild = [Diagnostics.Process]::Start($importStart)
    try {
        if (-not $importChild.WaitForExit($LimitSeconds * 1000)) { $importChild.Kill($true); throw "Godot's import exceeded $LimitSeconds seconds." }
        if ($importChild.ExitCode -ne 0) { throw "Godot's import failed with exit code $($importChild.ExitCode)." }
    }
    finally { $importChild.Dispose() }
    $still = @(Get-WorkshopStaleImports $Project)
    if ($still.Count) { throw "Godot could not import: $($still -join ', ')" }
}
