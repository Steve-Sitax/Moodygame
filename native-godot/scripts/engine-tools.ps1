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
    $engineStart.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $engineStart.RedirectStandardOutput = $true; $engineStart.RedirectStandardError = $true
    foreach ($argument in $EngineArguments) { $engineStart.ArgumentList.Add($argument) }
    $engineChild = [Diagnostics.Process]::new(); $engineChild.StartInfo = $engineStart
    try {
        [void]$engineChild.Start()
        $engineStdout = $engineChild.StandardOutput.ReadToEndAsync(); $engineStderr = $engineChild.StandardError.ReadToEndAsync()
        if (-not $engineChild.WaitForExit($LimitSeconds * 1000)) {
            $engineChild.Kill($true); throw "Godot exceeded its $LimitSeconds-second limit."
        }
        $engineText = $engineStdout.GetAwaiter().GetResult() + $engineStderr.GetAwaiter().GetResult()
        Set-Content -LiteralPath $Log -Value $engineText -Encoding utf8
        if ($engineChild.ExitCode -ne 0 -or $engineText -match '(?m)^ERROR:') {
            Write-Output (($engineText -split '\r?\n' | Select-Object -First 40) -join [Environment]::NewLine)
            throw "Godot failed. See $Log"
        }
        Write-Output $engineText.Trim()
    }
    finally { $engineChild.Dispose() }
}
