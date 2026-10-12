param([switch]$Apply,[string]$StandaloneProof)
$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$prefix=$workspace+[IO.Path]::DirectorySeparatorChar
function LocalPath([string]$Relative) {
    $path=[IO.Path]::GetFullPath((Join-Path $workspace $Relative))
    if(-not $path.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Retirement path escaped the migration worktree.'}
    return $path
}
function CheckTree([string]$Relative) {
    $path=LocalPath $Relative
    if(-not (Test-Path -LiteralPath $path)){return}
    $entries=@(Get-Item -LiteralPath $path -Force)+@(Get-ChildItem -LiteralPath $path -Force -Recurse)
    if($entries | Where-Object {($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0}){throw ('Retirement refuses linked paths: '+$Relative)}
}
if($workspace -ne [IO.Path]::GetFullPath('D:/Code/MoodyGame-native-authoring')){throw 'This one-time retirement plan is scoped to the reviewed migration worktree.'}
$inventory=Get-Content -LiteralPath (LocalPath 'native-godot/world/notes/legacy-retirement-files.json') -Raw | ConvertFrom-Json
$archive=[Collections.Generic.SortedDictionary[string,string]]::new([StringComparer]::Ordinal)
foreach($file in $inventory.groups.originalBrowserMedia){$archive[$file]='art-source/'+$file}
foreach($file in $inventory.groups.preserveArtworkTooling){$archive[$file]='art-source/'+$file}
foreach($file in Get-ChildItem -LiteralPath (LocalPath 'tools/city') -File){$relative='tools/city/'+$file.Name;$archive[$relative]='art-source/'+$relative}
foreach($file in Get-ChildItem -LiteralPath (LocalPath 'tools/templates') -File -Recurse){$relative=[IO.Path]::GetRelativePath($workspace,$file.FullName).Replace('\','/');$archive[$relative]='art-source/'+$relative}
foreach($file in Get-ChildItem -LiteralPath (LocalPath 'tools/release') -File){$relative='tools/release/'+$file.Name;$archive[$relative]='docs/archive/legacy-release-tools/'+$relative+'.txt'}
foreach($file in Get-ChildItem -LiteralPath (LocalPath 'shared') -File -Filter '*.json') {
    if($file.Name -ne 'package.json'){$relative='shared/'+$file.Name;$archive[$relative]='art-source/'+$relative}
}
foreach($file in $inventory.groups.obsoleteGodotEntry){$archive[$file]='docs/archive/legacy-godot-entry/'+$file+'.txt'}
$refresh=@(Get-ChildItem -LiteralPath (LocalPath 'native-godot/services') -File -Recurse | Where-Object {$_.Extension -in @('.mts','.mjs')})
$refresh+=@(Get-ChildItem -LiteralPath (LocalPath 'native-godot/recovery') -File -Recurse | Where-Object {$_.Extension -in @('.mts','.mjs')})
$refresh+=@(Get-ChildItem -LiteralPath (LocalPath 'native-godot/scripts') -File | Where-Object {$_.Extension -in @('.mts','.mjs')})
foreach($file in $refresh){$relative=[IO.Path]::GetRelativePath($workspace,$file.FullName).Replace('\','/');$archive[$relative]='docs/archive/legacy-oracle-tools/'+$relative+'.txt'}
$removeFiles=@($inventory.groups.nodeEntrypoints)+@($inventory.groups.nodeGameTooling)+@($inventory.groups.obsoleteGodotEntry)+@($inventory.groups.preserveArtworkTooling)+@($refresh | ForEach-Object {[IO.Path]::GetRelativePath($workspace,$_.FullName).Replace('\','/')})
$removeTrees=@('client','server','shared','node_modules','godot/baked','tools/city','tools/blender','tools/textures','tools/templates','tools/godot','tools/release','tools/demo')
foreach($directory in $removeTrees){CheckTree $directory}
foreach($file in $removeFiles){[void](LocalPath $file)}
# Refuse unexpected private files rather than archiving or deleting credentials with code.
foreach($directory in @('client','server','shared')) {
    $files=Get-ChildItem -LiteralPath (LocalPath $directory) -File -Force -Recurse | Where-Object {$_.FullName -notmatch '\\node_modules\\'}
    if($files | Where-Object {$_.Name -match '^(\.env($|\.)|ai-config|mp-config|mp-tokens|server-admin|credentials|keys\.json)' -or $_.Extension -in @('.sqlite','.db','.pfx','.p12','.pem','.key')}){throw ('Unexpected private data under legacy '+$directory+'; preserve it before applying retirement.')}
}
if(-not $Apply) {
    [ordered]@{apply=$false;workspace=$workspace;archiveFiles=$archive.Count;removeTrees=$removeTrees;removeFiles=$removeFiles.Count;gate='A successful relocated standalone result and verified package are required.'} | ConvertTo-Json
    return
}
if(-not $StandaloneProof){throw 'Supply the successful relocated standalone proof directory.'}
$proof=[IO.Path]::GetFullPath($StandaloneProof)
$proofPrefix=(LocalPath 'native-godot/proof')+[IO.Path]::DirectorySeparatorChar
if(-not $proof.StartsWith($proofPrefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Standalone receipt must be inside this worktree proof folder.'}
$result=Get-Content -LiteralPath (Join-Path $proof 'result.json') -Raw | ConvertFrom-Json
$package=Get-Content -LiteralPath (Join-Path $proof 'relocated game/package-verification.json') -Raw | ConvertFrom-Json
if(-not $result.passed -or -not $package.passed -or $package.fingerprint -notmatch '^[a-f0-9]{64}$'){throw 'Standalone release gate did not pass.'}
$rows=[Collections.Generic.List[object]]::new()
foreach($item in $archive.GetEnumerator()) {
    $source=LocalPath $item.Key;$target=LocalPath $item.Value
    if(-not (Test-Path -LiteralPath $source)){continue}
    $sha=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    [void](New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force)
    if(Test-Path -LiteralPath $target){if((Get-FileHash -LiteralPath $target).Hash.ToLowerInvariant() -ne $sha){throw ('Different archived file already exists: '+$item.Value)}}
    else{Copy-Item -LiteralPath $source -Destination $target}
    if((Get-FileHash -LiteralPath $target).Hash.ToLowerInvariant() -ne $sha){throw ('Archive checksum differs: '+$item.Key)}
    $rows.Add([ordered]@{source=$item.Key;archive=$item.Value;sha256=$sha})
}
[void](New-Item -ItemType Directory -Path (LocalPath 'art-source') -Force)
$rows | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (LocalPath 'art-source/retirement-manifest.json') -Encoding utf8
# Captured fixtures stay runnable; their former original-source refresh is explicitly retired.
foreach($script in Get-ChildItem -LiteralPath (LocalPath 'native-godot/services') -File -Filter 'check-*.ps1') {
    $text=[IO.File]::ReadAllText($script.FullName)
    if($text -match '\$RefreshLegacyOracles' -and $text -notmatch 'Original-source regeneration is retired') {
        $line="if(`$RefreshLegacyOracles){throw 'Original-source regeneration is retired. Use the retained fixtures; historical capture scripts are in docs/archive/legacy-oracle-tools.'}`n"
        $text=[regex]::Replace($text,'(?m)(\$ErrorActionPreference\s*=\s*.Stop.\s*\r?\n)',[Text.RegularExpressions.MatchEvaluator]{param($match)$match.Value+$line},1)
        [IO.File]::WriteAllText($script.FullName,$text,[Text.UTF8Encoding]::new($false))
    }
}
foreach($file in ($removeFiles | Sort-Object -Unique)) { $target=LocalPath $file;if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target} }
foreach($directory in $removeTrees) { $target=LocalPath $directory;CheckTree $directory;if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse} }
[ordered]@{retired=$true;archivedFiles=$rows.Count;fingerprint=$package.fingerprint;standaloneProof=$proof;removedTrees=$removeTrees;removedFiles=$removeFiles.Count;scope=$workspace;userDataTouched=$false} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (LocalPath 'native-godot/world/notes/legacy-retired.json') -Encoding utf8
Get-Content -LiteralPath (LocalPath 'native-godot/world/notes/legacy-retired.json') -Raw
