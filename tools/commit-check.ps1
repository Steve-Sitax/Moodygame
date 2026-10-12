param([string]$Workspace=(Join-Path $PSScriptRoot '..'))
$ErrorActionPreference='Stop'
$Workspace=[IO.Path]::GetFullPath($Workspace)
function Git([string[]]$Arguments,[string]$InputText='') {
    $start=[Diagnostics.ProcessStartInfo]::new('git')
    $start.WorkingDirectory=$Workspace;$start.UseShellExecute=$false;$start.CreateNoWindow=$true
    $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true;$start.RedirectStandardInput=$true
    $start.StandardOutputEncoding=[Text.Encoding]::UTF8
    foreach($argument in $Arguments){$start.ArgumentList.Add($argument)}
    $process=[Diagnostics.Process]::new();$process.StartInfo=$start
    try {
        [void]$process.Start();$output=$process.StandardOutput.ReadToEndAsync();$errors=$process.StandardError.ReadToEndAsync()
        if($InputText){$process.StandardInput.Write($InputText)};$process.StandardInput.Close();$process.WaitForExit()
        if($process.ExitCode -ne 0){throw $errors.GetAwaiter().GetResult()}
        return $output.GetAwaiter().GetResult()
    } finally {$process.Dispose()}
}
$never=@(
    @('^data/','game saves/settings'),
    @('(?i)\.(sqlite|sqlite3|db)(-wal|-shm|-journal)?$','database/save'),
    @('(^|/)\.env(\.|$)','environment file'),
    @('ai-config[^/]*\.json$','AI credentials/settings'),
    @('(^|/)\.claude/','private session files'),
    @('(?i)\.(kdb[x]|pem|key|p12|pfx|crt|cer)$','key/certificate/password vault'),
    @('(?i)\.(orig|rej|bak|swp|log|tmp)$','generated/editor leftover'),
    @('(^|/)(node_modules|dist|dist-demo|\.godot|bin|obj)/|^release/','dependencies/build output'),
    @('(?i)(^|/)(Thumbs\.db|\.DS_Store|desktop\.ini)$','OS file')
)
$secret=@(
    'sk-ant-[A-Za-z0-9_-]{20,}', 'sk-(proj-)?[A-Za-z0-9]{32,}', 'gh[pousr]_[A-Za-z0-9]{30,}',
    'github_pat_[A-Za-z0-9_]{20,}', 'AKIA[0-9A-Z]{16}', 'AIza[0-9A-Za-z_-]{30,}',
    'xox[baprs]-[A-Za-z0-9-]{10,}', '-----BEGIN [A-Z ]*PRIVATE KEY-----[A-Za-z0-9+/=]',
    '(?i)\b(password|passwd|secret|api[_-]?key|token)\b\s*[:=]\s*["''][^"''\s]{8,}["'']',
    '//[^/\s:@]+:[^/\s@]{6,}@'
)
$wordFile=Join-Path $Workspace '.claude/private-words.txt'
if(-not (Test-Path -LiteralPath $wordFile)) {
    $common=[IO.Path]::GetFullPath((Git @('rev-parse','--git-common-dir')).Trim(),$Workspace)
    $wordFile=Join-Path ([IO.Path]::GetDirectoryName($common)) '.claude/private-words.txt'
}
$words=if(Test-Path -LiteralPath $wordFile){@(Get-Content -LiteralPath $wordFile | ForEach-Object {$_.Trim()} | Where-Object {$_ -and -not $_.StartsWith('#')})}else{@()}
$wordPattern=if($words.Count){'(?i)(^|[^A-Za-z0-9])('+ (($words | ForEach-Object {[regex]::Escape($_)}) -join '|') +')(?![A-Za-z0-9])'}else{$null}
$finds=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$staged=@((Git @('diff','--cached','--name-only','--diff-filter=ACMR','-z')).Split([char]0) | Where-Object {$_})
$index=@{}
foreach($entry in (Git @('ls-files','--stage','-z')).Split([char]0)) {
    if($entry -match '^\d+ ([a-f0-9]+) 0\t(.+)$'){$index[$Matches[2]]=$Matches[1]}
}
$hashes=@($staged | ForEach-Object {$index[$_]} | Where-Object {$_} | Sort-Object -Unique)
$sizes=@{}
if($hashes.Count) {
    foreach($entry in (Git @('cat-file','--batch-check') (($hashes -join "`n")+"`n")).Split("`n")) {
        if($entry -match '^([a-f0-9]+) blob (\d+)$'){$sizes[$Matches[1]]=[long]$Matches[2]}
    }
}
foreach($file in $staged) {
    foreach($rule in $never){if([regex]::IsMatch($file,$rule[0])){[void]$finds.Add($file+': '+$rule[1]);break}}
    if($index.ContainsKey($file) -and $sizes[$index[$file]] -gt 25MB){[void]$finds.Add($file+': over the existing 25 MB limit')}
}
$file='';$number=0
foreach($line in (Git @('-c','core.quotepath=false','diff','--cached','-U0','--no-color','--no-ext-diff','--diff-filter=ACMR')).Split("`n")) {
    if($line.StartsWith('+++ ')){$file=$line.Substring(4) -replace '^b/','';continue}
    if($line -match '^@@ -\d+(?:,\d+)? \+(\d+)'){$number=[int]$Matches[1];continue}
    if(-not $line.StartsWith('+')){continue}
    $text=$line.Substring(1)
    if($file -notin @('tools/commit-check.ps1','tools/commit-check.mjs') -and $text -notmatch '(?i)FAKE|example|placeholder|dummy|<[^>]+>') {
        foreach($pattern in $secret){if([regex]::IsMatch($text,$pattern)){[void]$finds.Add($file+':'+$number+': possible key/token/password');break}}
    }
    if($wordPattern -and [regex]::IsMatch($text,$wordPattern)){[void]$finds.Add($file+':'+$number+': private word from the local exclusion list')}
    $number++
}
if($finds.Count){foreach($finding in ($finds | Sort-Object)){Write-Output $finding};throw 'Staged privacy check failed. Fix findings and stage again; do not skip the guard.'}
Write-Output ('Native staged privacy check PASS: '+$staged.Count+' files; existing 25 MB limit preserved.')
