param([string]$Name = 'run', [string[]]$Extra = @(), [int]$Runs = 1, [int]$LimitSeconds = 600,
    [int]$Port = 18891, [string]$DataDirectory = '')
# Times real starts through the menu into play with an isolated save (docs/startup.md). Plain ASCII on purpose.
# Writes .scratch/startup-perf/<Name>-<n>.log/.json; prints the playable time and any engine error or warning.
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$engine = Resolve-WorkshopGodot
$out = Join-Path $workspace '.scratch/startup-perf'
$data = if ($DataDirectory) { [IO.Path]::GetFullPath($DataDirectory) } else { Join-Path $out 'playable-data' }
[void][IO.Directory]::CreateDirectory($data)
$env:SCHELDEMIST_USER_DATA = $data
for ($i = 1; $i -le $Runs; $i++) {
    $base = Join-Path $out "$Name-$i"
    $startedAt = [DateTime]::UtcNow
    $engineArgs = @('--audio-driver', 'Dummy', '--rendering-method', 'forward_plus', '--path', (Join-Path $workspace 'native-godot'), '--',
        '--no-ai', '--port', "$Port", '--db', "$data/game.sqlite", '--prefs', "$data/settings.json",
        '--author-root', (Join-Path $out 'layouts'), '--startup-proof', "$base.json") + $Extra
    $quoted = ($engineArgs | ForEach-Object { '"' + $_ + '"' }) -join ' '
    # (cmd redirection: a PowerShell redirect of the game's output slows the start itself)
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', ('""' + $engine + '" ' + $quoted + ' > "' + "$base.log" + '" 2>&1"')) -PassThru -NoNewWindow
    if (-not $p.WaitForExit($LimitSeconds * 1000)) { $p.Kill($true); throw "$Name-$i timed out" }
    Select-String -Path "$base.log" -Pattern 'STARTUP_PLAYABLE|^ERROR|^WARNING|town digest|map digest|ruien pieces' | ForEach-Object { "$Name-$i " + $_.Line }
    $p.Refresh()
    if ($p.ExitCode -ne 0 -or (Select-String -Path "$base.log" -Pattern '^ERROR:|Unhandled exception' -Quiet)) { throw "$Name-$i failed; see $base.log" }
    if (-not (Test-Path -LiteralPath "$base.json") -or (Get-Item -LiteralPath "$base.json").LastWriteTimeUtc -lt $startedAt) { throw "$Name-$i did not write a new playable proof" }
    $proof = Get-Content -LiteralPath "$base.json" -Raw | ConvertFrom-Json
    if ($proof.playableMs -le 0 -or $proof.residents -le 0) { throw "$Name-$i did not reach populated gameplay" }
}
