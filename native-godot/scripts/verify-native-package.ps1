param([Parameter(Mandatory)][string]$Package, [string]$Executable = 'Scheldemist.exe')
$ErrorActionPreference = 'Stop'
$Package = [IO.Path]::GetFullPath($Package)
$checks = 0
function Assert-Package([bool]$Okay,[string]$Message) {
    $script:checks++
    if(-not $Okay){throw $Message}
}
Assert-Package (Test-Path -LiteralPath (Join-Path $Package $Executable)) 'Missing exported game executable.'
$pck = Join-Path $Package ([IO.Path]::ChangeExtension($Executable,'.pck'))
Assert-Package (Test-Path -LiteralPath $pck) 'Missing native resource pack.'
foreach($required in @('LICENSE.txt','ATTRIBUTION.md')){Assert-Package (Test-Path -LiteralPath (Join-Path $Package $required)) "Missing licence/credits: $required"}
$all = @(Get-ChildItem -LiteralPath $Package -File -Recurse)
$names = @($all.Name)
foreach($required in @('Scheldemist.Native.dll','Scheldemist.dll','GodotSharp.dll','coreclr.dll','hostfxr.dll','hostpolicy.dll','System.Private.CoreLib.dll','Microsoft.AspNetCore.Server.Kestrel.Core.dll','Microsoft.AspNetCore.Http.dll','Microsoft.Data.Sqlite.dll','e_sqlite3.dll')) {
    Assert-Package ($names -contains $required) "Missing self-contained runtime dependency: $required"
}
Assert-Package ($names -notcontains 'GodotSharpEditor.dll') 'Editor-only Godot API was shipped.'
foreach($file in $all) {
    $relative = [IO.Path]::GetRelativePath($Package,$file.FullName).Replace('\','/')
    Assert-Package ($relative -notmatch '(^|/)(node_modules|client|server)/|\.(js|mjs|ts|tsx|glb|sqlite|db|pdb)$|(?i)(ai-config|credentials|mp-tokens|mp-config|server-admin|settings|keys)\.json$') "Source, user data or developer file was shipped: $relative"
}
$stream = [IO.File]::OpenRead($pck)
$reader = [IO.BinaryReader]::new($stream,[Text.Encoding]::UTF8,$true)
try {
    Assert-Package ($reader.ReadUInt32() -eq 0x43504447) 'Invalid Godot PCK header.'
    $format = $reader.ReadUInt32()
    Assert-Package ($format -in @(2,3,4)) "Unsupported Godot PCK version: $format"
    $engine = @($reader.ReadUInt32(),$reader.ReadUInt32(),$reader.ReadUInt32())
    $flags = $reader.ReadUInt32()
    Assert-Package (($flags -band 1) -eq 0) 'Encrypted pack requires a different verifier.'
    $fileBase = $reader.ReadUInt64()
    if($format -ge 3){$directory = $reader.ReadUInt64();[void]$stream.Seek($directory,[IO.SeekOrigin]::Begin)}
    else{[void]$reader.ReadBytes(64)}
    $count = $reader.ReadUInt32()
    Assert-Package ($count -gt 1000 -and $count -lt 1000000) 'Native town resource count is implausible.'
    $entries = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
    for($i=0;$i -lt $count;$i++) {
        $length = $reader.ReadUInt32()
        Assert-Package ($length -gt 0 -and $length -lt 4096) 'Invalid packed resource path length.'
        $path = [Text.Encoding]::UTF8.GetString($reader.ReadBytes($length)).TrimEnd([char]0)
        if($path.StartsWith('res://')){$path=$path.Substring(6)}
        $offset = $reader.ReadUInt64()+$fileBase
        $size = $reader.ReadUInt64()
        [void]$reader.ReadBytes(16)
        $entryFlags = $reader.ReadUInt32()
        Assert-Package ($entryFlags -eq 0) "Unexpected encrypted/removed resource: $path"
        Assert-Package ($offset -le $stream.Length -and $size -le $stream.Length-$offset) "Packed resource exceeds pack: $path"
        Assert-Package ($path -notmatch '^(proof|recovery|scripts|world/notes|services/(fixtures|proof|proofs)|dist)/|^recovered/recovery-fixture-[^/]+/|^services/(coverage|legacy-routes|north-network-notes|north-services-notes)\.json$|(^|/)(layouts|node_modules|baked)/|\.(glb|js|mjs|ts|tsx|sqlite|db)$|(?i)(ai-config|credentials|mp-tokens|mp-config|server-admin|settings|keys)\.json$') "Unwanted packed file: $path"
        $entries.Add($path,[pscustomobject]@{offset=$offset;size=$size})
    }
    function Read-Packed([string]$Path) {
        Assert-Package ($entries.ContainsKey($Path)) "Missing packed resource: $Path"
        $entry = $entries[$Path]
        [void]$stream.Seek($entry.offset,[IO.SeekOrigin]::Begin)
        if($entry.size -gt [int]::MaxValue){throw "Resource too large for verifier: $Path"}
        return ,$reader.ReadBytes([int]$entry.size)
    }
    foreach($required in @('project.binary','town.tscn','world/town/facts.json','world/network-content.json','world/data/pack/manifest.json')){Assert-Package ($entries.ContainsKey($required) -or $entries.ContainsKey($required+'.remap')) "Missing runtime root: $required"}
    $fingerprint = [Text.Encoding]::UTF8.GetString((Read-Packed 'world/network-content.json')) | ConvertFrom-Json
    Assert-Package ($fingerprint.fingerprint -match '^[a-f0-9]{64}$') 'Invalid network content fingerprint.'
    $manifest = [Text.Encoding]::UTF8.GetString((Read-Packed 'world/data/pack/manifest.json')) | ConvertFrom-Json
    Assert-Package ($manifest.format -eq 2) 'Missing explicit raw-data packet.'
    foreach($row in $manifest.files) {
        $bytes = Read-Packed ('world/data/pack/'+$row.blob)
        Assert-Package ($bytes.LongLength -eq $row.bytes -and [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant() -eq $row.sha256) "Raw data checksum failed: $($row.file)"
    }
    foreach($entry in $entries.GetEnumerator()) {
        if($entry.Key.EndsWith('.cs')){Assert-Package ($entry.Value.size -le 2) "C# source content was shipped: $($entry.Key)"}
    }
    [ordered]@{passed=$true;checks=$checks;engine=($engine -join '.');pckFormat=$format;packedResources=$count;staticFiles=$manifest.files.Count;staticVersion=$manifest.version;fingerprint=$fingerprint.fingerprint;package=$Package} | ConvertTo-Json
}
finally{$reader.Dispose();$stream.Dispose()}
