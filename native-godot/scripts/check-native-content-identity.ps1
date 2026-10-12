param([string]$Project=(Join-Path $PSScriptRoot '..'))
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'native-content-identity.ps1')
$Project=[IO.Path]::GetFullPath($Project)
$proof=Join-Path $Project ('proof/content-identity-'+[Guid]::NewGuid().ToString('N'))
$checks=0
function Check([bool]$Okay,[string]$Name){$script:checks++;if(-not $Okay){throw $Name}}
function Inputs([string]$Root){$items=[Collections.Generic.SortedDictionary[string,string]]::new([StringComparer]::Ordinal);Add-NativeRuntimeSourceIdentity (Join-Path $Root 'native-godot') $items;return ,$items}
foreach($folder in @('a','b')) {
    $root=Join-Path $proof $folder
    [void](New-Item -ItemType Directory -Path (Join-Path $root 'native-godot/src/World'),(Join-Path $root 'native-godot/src/Recovery'),(Join-Path $root 'godot/src/Net'),(Join-Path $root 'godot/src/Dev') -Force)
    $eol=if($folder -eq 'a'){"`r`n"}else{"`n"}
    $encoding=[Text.UTF8Encoding]::new($folder -eq 'a')
    foreach($file in @('native-godot/src/World/Runtime.cs','godot/src/Net/Protocol.cs','native-godot/Scheldemist.Native.csproj','godot/Scheldemist.csproj','Directory.Build.props')) {
        [IO.File]::WriteAllText((Join-Path $root $file),('same'+$eol+'source'+$eol),$encoding)
    }
    foreach($file in @('native-godot/src/World/RuntimeProof.cs','native-godot/src/Recovery/RecoveryGlb.cs','godot/src/Dev/TownPreview.cs','godot/src/Dev/EventTest.Actions.cs')) {
        [IO.File]::WriteAllText((Join-Path $root $file),$folder)
    }
}
$a=Inputs (Join-Path $proof 'a');$b=Inputs (Join-Path $proof 'b')
Check ($a.Count -eq 5) 'runtime and build inputs included; proof/recovery/editor source excluded'
Check ((Get-NativeContentFingerprint $a) -eq (Get-NativeContentFingerprint $b)) 'BOM/line ending differences preserve identity'
[IO.File]::AppendAllText((Join-Path $proof 'b/godot/src/Net/Protocol.cs'),'changed protocol')
$changed=Inputs (Join-Path $proof 'b')
Check ((Get-NativeContentFingerprint $a) -ne (Get-NativeContentFingerprint $changed)) 'protocol code change rejects old identity'
$live=[Collections.Generic.SortedDictionary[string,string]]::new([StringComparer]::Ordinal)
Add-NativeRuntimeSourceIdentity $Project $live
Check ($live.ContainsKey('source/native-godot/src/World/NativeNetworkHost.cs')) 'real native transport is hashed'
Check ($live.ContainsKey('source/godot/src/Net/Mp/NativeWorldPacket.cs')) 'real shared wire protocol is hashed'
Check (-not $live.ContainsKey('source/native-godot/src/World/NativePackageProof.cs')) 'real proof is excluded'
Check ($live.ContainsKey('source/native-godot/Scheldemist.Native.csproj') -and $live.ContainsKey('source/godot/Scheldemist.csproj')) 'both real build manifests are hashed'
[ordered]@{passed=$true;checks=$checks;runtimeSourceFiles=$live.Count;sourceFingerprint=(Get-NativeContentFingerprint $live)} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $proof 'result.json') -Encoding utf8
Get-Content -LiteralPath (Join-Path $proof 'result.json') -Raw
