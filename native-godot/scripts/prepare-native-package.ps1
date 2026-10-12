param([string]$Project = (Join-Path $PSScriptRoot '..'))
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'native-content-identity.ps1')
$Project = [IO.Path]::GetFullPath($Project)
$sourceData = Join-Path $Project 'world/data'
$pack = Join-Path $sourceData 'pack'
$blobs = Join-Path $pack 'blobs'
[void](New-Item -ItemType Directory -Path $blobs -Force)
$loose = Get-Content -LiteralPath (Join-Path $sourceData 'manifest.json') -Raw | ConvertFrom-Json
$files = [Collections.Generic.SortedDictionary[string,string]]::new([StringComparer]::Ordinal)
foreach($name in $loose.files) {
    if($name -eq 'shared/package.json'){continue}
    if($name -match '(^/|\\|(^|/)\.\.(/|$)|^[A-Za-z]:)'){throw "Invalid static data path: $name"}
    $files[$name] = Join-Path $sourceData $name
}
foreach($entry in @(@('services','services/data'),@('maps','world/town/maps'))) {
    foreach($file in Get-ChildItem -LiteralPath (Join-Path $Project $entry[1]) -File) {
        if($file.Name.EndsWith('.import') -or $file.Name.EndsWith('.uid')){continue}
        $files[$entry[0]+'/'+$file.Name] = $file.FullName
    }
}
$rows = [Collections.Generic.List[object]]::new()
$utf8 = [Text.UTF8Encoding]::new($false)
foreach($entry in $files.GetEnumerator()) {
    if($entry.Key -match '\.(js|mjs|ts|tsx|glb|sqlite|db)$' -or $entry.Key -match '(?i)(ai-config|credentials|mp-tokens|mp-config|server-admin|settings|keys)\.json$'){throw "Runtime pack contains source or user settings: $($entry.Key)"}
    $content = [IO.File]::ReadAllBytes($entry.Value)
    if($entry.Key.EndsWith('.json')){[void]($utf8.GetString($content) | ConvertFrom-Json)}
    $sha = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($content)).ToLowerInvariant()
    $target = Join-Path $blobs ($sha+'.bin')
    if(-not (Test-Path -LiteralPath $target) -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha) {
        $temporary = $target+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
        [IO.File]::WriteAllBytes($temporary,$content)
        Move-Item -LiteralPath $temporary -Destination $target -Force
    }
    $rows.Add([ordered]@{file=$entry.Key;blob='blobs/'+$sha+'.bin';sha256=$sha;bytes=$content.LongLength})
}
$identity = $rows | ConvertTo-Json -Depth 5 -Compress
$version = 'native-pack-'+[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($utf8.GetBytes($identity))).ToLowerInvariant()
$manifest = [ordered]@{format=2;version=$version;files=$rows}
[IO.File]::WriteAllText((Join-Path $pack 'manifest.json'),($manifest | ConvertTo-Json -Depth 6),$utf8)
# Remove only preceding generated immutable blobs. Resolve and check every target first.
$liveBlobs = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach($row in $rows){[void]$liveBlobs.Add([IO.Path]::GetFileName($row.blob))}
$blobRoot = [IO.Path]::GetFullPath($blobs)+[IO.Path]::DirectorySeparatorChar
foreach($file in Get-ChildItem -LiteralPath $blobs -File -Filter '*.bin') {
    $resolved = [IO.Path]::GetFullPath($file.FullName)
    if(-not $resolved.StartsWith($blobRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Generated blob path escaped package folder.'}
    if($file.Name -match '^[a-f0-9]{64}\.bin$' -and -not $liveBlobs.Contains($file.Name)){Remove-Item -LiteralPath $resolved}
}

# The fingerprint follows the client/server-shipped native content, never saves or editor overlays.
$contentFiles = [Collections.Generic.SortedDictionary[string,string]]::new([StringComparer]::Ordinal)
$extensions = @('.tscn','.tres','.res','.scn','.gdshader','.gdshaderinc','.png','.jpg','.jpeg','.webp','.svg','.woff2','.ogg','.wav','.json','.sql','.bin','.uid')
foreach($file in Get-ChildItem -LiteralPath $Project -File -Recurse) {
    $relative = [IO.Path]::GetRelativePath($Project,$file.FullName).Replace('\','/')
    if($relative -match '(^|/)\.' -or $relative -match '^(addons|proof|recovery|scripts|dist|world/notes|services/(fixtures|proof|proofs))/' -or $relative -match '^recovered/recovery-fixture-[^/]+/' -or $relative -in @('world/network-content.json','world/data/shared/package.json','services/coverage.json','services/legacy-routes.json','services/north-network-notes.json','services/north-services-notes.json') -or $relative -match '/layouts/'){continue}
    $included = $extensions -contains $file.Extension.ToLowerInvariant() -or $relative -eq 'project.godot' -or $relative -match '^fonts/.*(?:LICENSE|OFL).*\.txt$'
    if($relative -match '^src/' -or $relative -match '(Proof|Recovery)\.cs$' -or -not $included){continue}
    # Keep only live blobs listed by this manifest; preceding generated immutable blobs are not shipped.
    if($relative.StartsWith('world/data/pack/blobs/') -and -not ($rows.blob -contains $relative.Substring('world/data/pack/'.Length))){continue}
    $contentFiles[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
}
Add-NativeRuntimeSourceIdentity $Project $contentFiles
$fingerprint = Get-NativeContentFingerprint $contentFiles
[IO.File]::WriteAllText((Join-Path $Project 'world/network-content.json'),([ordered]@{fingerprint=$fingerprint} | ConvertTo-Json),$utf8)
$receipt = [ordered]@{version=$version;files=$rows.Count;bytes=($rows.bytes | Measure-Object -Sum).Sum;contentFiles=$contentFiles.Count;fingerprint=$fingerprint}
$receipt | ConvertTo-Json
