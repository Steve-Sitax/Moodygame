param([string]$Output = (Join-Path $env:TEMP ('workshop-imports-' + [guid]::NewGuid().ToString('N'))))
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'engine-tools.ps1')
if (Test-Path -LiteralPath $Output) { throw 'Use a fresh fixture directory.' }
$project = [IO.Path]::GetFullPath($Output)
$cache = Join-Path $project '.godot/imported'
[void](New-Item -ItemType Directory -Path $cache -Force)
$source = Join-Path $project 'cloth.png'
$resource = '.godot/imported/cloth.png-0123456789abcdef0123456789abcdef.bptc.ctex'
$receipt = Join-Path $cache 'cloth.png-0123456789abcdef0123456789abcdef.md5'
[IO.File]::WriteAllText($source, 'old UV layout')
[IO.File]::WriteAllText((Join-Path $project $resource), 'existing GPU texture')
[IO.File]::WriteAllText(($source + '.import'), ('[deps]' + "`n" + 'dest_files=["res://' + $resource + '"]'))
function Receipt {
    [IO.File]::WriteAllText($receipt, ('source_md5="' + (Get-FileHash -LiteralPath $source -Algorithm MD5).Hash.ToLowerInvariant() + '"'))
}
$checks = [Collections.Generic.List[object]]::new()
function Check([string]$Name, [int]$Expected) {
    $actual = @(Get-WorkshopStaleImports $project).Count
    $checks.Add(@{name=$Name; expected=$Expected; actual=$actual; ok=($actual -eq $Expected)})
    if ($actual -ne $Expected) { throw "$Name expected $Expected stale imports; got $actual" }
}
Receipt
Check 'Current source and existing cache' 0
$date = (Get-Item -LiteralPath $source).LastWriteTimeUtc
[IO.File]::WriteAllText($source, 'new UV layout')
(Get-Item -LiteralPath $source).LastWriteTimeUtc = $date
Check 'Changed bytes with unchanged length and timestamp' 1
Receipt
Check 'Reimported source' 0
Remove-Item -LiteralPath $receipt
Check 'Missing import receipt' 1
Receipt
Remove-Item -LiteralPath (Join-Path $project $resource)
Check 'Missing GPU texture' 1
[IO.File]::WriteAllText((Join-Path $project $resource), 'existing GPU texture')
[IO.File]::WriteAllText((Join-Path $project 'retired.png.import'), 'dest_files=["res://.godot/imported/retired.ctex"]')
Check 'Orphan settings from retired source' 0
$checks | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $project 'result.json')
Write-Output "PASS: $($checks.Count) import freshness checks; $project/result.json"
