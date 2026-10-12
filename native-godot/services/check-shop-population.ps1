param([switch]$RefreshLegacyOracles,[switch]$Staged,[switch]$HomesNight)
$ErrorActionPreference='Stop'
if($RefreshLegacyOracles){throw 'Original-source regeneration is retired. Use the retained fixtures; historical capture scripts are in docs/archive/legacy-oracle-tools.'}
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if($RefreshLegacyOracles){& node (Join-Path $PSScriptRoot 'shop-population-oracles.mts');if($LASTEXITCODE -ne 0){throw 'Original shop population recovery failed.'}}
$folder=Join-Path $workspace ('.scratch\native-shop-population-proof-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$services=[System.Security.SecurityElement]::Escape((Join-Path $workspace 'native-godot/src/Services').Replace('\','/'))
$assemblies=[System.Security.SecurityElement]::Escape((Join-Path $workspace 'godot/.godot/mono/temp/bin/Debug').Replace('\','/'))
$project=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'proof/CoreProof.csproj.in') -Raw
$project=$project.Replace('../../native-godot/src/Services',$services)
$extras=@'
  <ItemGroup>
    <Reference Include="Scheldemist"><HintPath>ASSEMBLIES/Scheldemist.dll</HintPath></Reference>
    <Reference Include="GodotSharp"><HintPath>ASSEMBLIES/GodotSharp.dll</HintPath></Reference>
    <Compile Include="SERVICES/NativeTown.cs" />
    <Compile Include="SERVICES/NativeTownPopulation.cs" />
    <Compile Include="SERVICES/NativeTownHouseDoors.cs" />
  </ItemGroup>
'@
$extras=$extras.Replace('ASSEMBLIES',$assemblies).Replace('SERVICES',$services)
$project=$project.Replace('</Project>',$extras+'</Project>')
$moduleNames=@('NativeTownShopsPopulation','NativeTownCafesPopulation')
if($HomesNight){$moduleNames=@('NativeTownHomesPopulation','NativeTownNightPopulation')}
if(-not $Staged){foreach($name in $moduleNames){$project=$project.Replace('</Project>','<ItemGroup><Compile Include="'+$services+'/'+$name+'.cs" /></ItemGroup></Project>')}}
Set-Content -LiteralPath (Join-Path $folder 'ShopProof.csproj') -Value $project -Encoding utf8
if($Staged){foreach($name in $moduleNames){Copy-Item -LiteralPath (Join-Path $workspace ('native-godot/src/Services/'+$name+'.cs.txt')) -Destination (Join-Path $folder ($name+'.cs'))}}
$proofType='NativeShopsCafesPopulationProof'
if($HomesNight){$proofType='NativeHomesNightPopulationProof'}
$program=Get-Content -LiteralPath (Join-Path $workspace ('native-godot/src/Services/'+$proofType+'.cs')) -Raw
$program=$program.Replace('public partial class '+$proofType+' : Node','public static class '+$proofType).Replace('public override void _Ready()','public static void Main(string[] args)').Replace('var args=OS.GetCmdlineUserArgs();','').Replace('ProjectSettings.GlobalizePath(', 'Globalize(').Replace('GD.Print(','Console.WriteLine(').Replace('GD.PushError(','Console.Error.WriteLine(').Replace('GetTree().Quit();','').Replace('GetTree().Quit(1);','System.Environment.Exit(1);').Replace('NativePopulationProof.Difference','Difference')
$helper=@'
    private static string Globalize(string path)=>Path.Combine("WORKSPACE/native-godot",path.StartsWith("res://")?path[6..]:path);
    private static string? Difference(JsonNode? expected,JsonNode? actual,string path){
        if(expected==null||actual==null)return expected==null&&actual==null?null:path+" null differs";
        if(expected is JsonObject e&&actual is JsonObject a){if(e.Count!=a.Count)return path+" keys expected "+string.Join(",",e.Select(p=>p.Key))+"; actual "+string.Join(",",a.Select(p=>p.Key));foreach(var p in e){if(!a.ContainsKey(p.Key))return path+" missing "+p.Key;if(Difference(p.Value,a[p.Key],path+"."+p.Key)is{} d)return d;}return null;}
        if(expected is JsonArray ee&&actual is JsonArray aa){if(ee.Count!=aa.Count)return path+" lengths differ";for(int i=0;i<ee.Count;i++)if(Difference(ee[i],aa[i],path+"["+i+"]")is{} d)return d;return null;}
        if(expected.GetValueKind()==JsonValueKind.Number&&actual.GetValueKind()==JsonValueKind.Number)return Math.Abs(double.Parse(expected.ToJsonString(),System.Globalization.CultureInfo.InvariantCulture)-double.Parse(actual.ToJsonString(),System.Globalization.CultureInfo.InvariantCulture))<1e-9?null:path+" numbers "+expected+" != "+actual;
        return JsonNode.DeepEquals(expected,actual)?null:path+" "+expected+" != "+actual;
    }
'@
$helper=$helper.Replace('WORKSPACE',$workspace.Replace('\','/'))
$position=$program.LastIndexOf('}')
$program=$program.Insert($position,$helper)
Set-Content -LiteralPath (Join-Path $folder 'Program.cs') -Value $program -Encoding utf8
$output=Join-Path $workspace ('native-godot/proof/shop-population-'+[Guid]::NewGuid().ToString('N')+'/result.json')
& dotnet run --project (Join-Path $folder 'ShopProof.csproj') -- $output (Join-Path $workspace 'native-godot/services/data')
if($LASTEXITCODE -ne 0){throw 'Native shops/cafes population proof failed.'}



