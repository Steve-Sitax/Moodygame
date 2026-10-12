function Get-NativeNormalizedTextHash([string]$Path) {
    $text=[IO.File]::ReadAllText($Path).TrimStart([char]0xfeff).Replace("`r`n","`n").Replace("`r","`n")
    $bytes=[Text.UTF8Encoding]::new($false).GetBytes($text)
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}

function Add-NativeRuntimeSourceIdentity([string]$Project,$ContentFiles) {
    $repository=[IO.Path]::GetFullPath((Join-Path $Project '..'))
    $roots=@(@('native-godot',(Join-Path $Project 'src')),@('godot',(Join-Path $repository 'godot/src')))
    foreach($entry in $roots) {
        foreach($file in Get-ChildItem -LiteralPath $entry[1] -Recurse -File -Filter '*.cs') {
            $relative=[IO.Path]::GetRelativePath($entry[1],$file.FullName).Replace('\','/')
            if($relative -match '(^|/)(Recovery|Editor)/' -or $relative -match '(Proof|Recovery)\.cs$' -or $relative -match 'Test(?:\.|\.cs$)' -or $relative -eq 'Dev/TownPreview.cs'){continue}
            $ContentFiles['source/'+$entry[0]+'/src/'+$relative]=Get-NativeNormalizedTextHash $file.FullName
        }
    }
    foreach($relative in @('native-godot/Scheldemist.Native.csproj','godot/Scheldemist.csproj','Directory.Build.props','Directory.Build.targets','global.json','native-godot/Directory.Build.props','native-godot/Directory.Build.targets','godot/Directory.Build.props','godot/Directory.Build.targets')) {
        $path=Join-Path $repository $relative
        if(Test-Path -LiteralPath $path){$ContentFiles['source/'+$relative]=Get-NativeNormalizedTextHash $path}
    }
}

function Get-NativeContentFingerprint($ContentFiles) {
    $lines=[Collections.Generic.List[string]]::new()
    foreach($entry in $ContentFiles.GetEnumerator()){$lines.Add($entry.Key+[char]0+$entry.Value+"`n")}
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.UTF8Encoding]::new($false).GetBytes([string]::Concat($lines)))).ToLowerInvariant()
}
