param([string]$Name = 'run', [string[]]$Extra = @(), [int]$Runs = 1, [int]$LimitSeconds = 600)
# Times real starts through the menu into play with an isolated save (docs/startup.md). Plain ASCII on purpose.
# Writes .scratch/startup-perf/<Name>-<n>.log/.json; prints the playable time and any engine error or warning.
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
$engine = Resolve-WorkshopGodot
$out = Join-Path $workspace '.scratch/startup-perf'
$data = Join-Path $out 'playable-data'
[void][IO.Directory]::CreateDirectory($data)
$env:SCHELDEMIST_USER_DATA = $data
for ($i = 1; $i -le $Runs; $i++) {
    $base = Join-Path $out "$Name-$i"
    $engineArgs = @('--audio-driver', 'Dummy', '--rendering-method', 'forward_plus', '--path', (Join-Path $workspace 'native-godot'), '--',
        '--no-ai', '--port', '18891', '--db', "$data/game.sqlite", '--prefs', "$data/settings.json",
        '--author-root', (Join-Path $out 'layouts'), '--startup-proof', "$base.json") + $Extra
    $quoted = ($engineArgs | ForEach-Object { '"' + $_ + '"' }) -join ' '
    # (cmd redirection: a PowerShell redirect of the game's output slows the start itself)
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', ('""' + $engine + '" ' + $quoted + ' > "' + "$base.log" + '" 2>&1"')) -PassThru -NoNewWindow
    if (-not $p.WaitForExit($LimitSeconds * 1000)) { $p.Kill($true); throw "$Name-$i timed out" }
    Select-String -Path "$base.log" -Pattern 'STARTUP_PLAYABLE|^ERROR|^WARNING|town digest|map digest|ruien pieces' | ForEach-Object { "$Name-$i " + $_.Line }
}
