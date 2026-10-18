param([ValidateSet('Workshops','Transport','Lamps','Lifecycle')][string]$Proof='Transport',[switch]$RefreshLegacyOracles,[switch]$Record)
$ErrorActionPreference='Stop'
if($RefreshLegacyOracles){throw 'Original-source regeneration is retired. Use the retained fixtures; historical capture scripts are in docs/archive/legacy-oracle-tools.'}
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if($RefreshLegacyOracles -and $Proof -ne 'Lamps') {
    $oracleName=if($Proof -eq 'Lifecycle'){'outer-population-lifecycle-oracle.mjs'}else{'outer-'+$Proof.ToLower()+'-population-oracle.mjs'}
    & node --experimental-strip-types (Join-Path $workspace ('native-godot/recovery/full/'+$oracleName))
    if($LASTEXITCODE -ne 0){throw 'Original outer population oracle failed.'}
}
$folder=Join-Path $workspace ('.scratch\native-outer-population-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$services=[System.Security.SecurityElement]::Escape((Join-Path $workspace 'native-godot/src/Services').Replace('\','/'))
$assemblies=[System.Security.SecurityElement]::Escape((Join-Path $workspace 'godot/.godot/mono/temp/bin/Debug').Replace('\','/'))
$project=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'proof/CoreProof.csproj.in') -Raw).Replace('../../native-godot/src/Services',$services)
$extras=@'
  <ItemGroup>
    <Reference Include="Scheldemist"><HintPath>ASSEMBLIES/Scheldemist.dll</HintPath></Reference>
    <Reference Include="GodotSharp"><HintPath>ASSEMBLIES/GodotSharp.dll</HintPath></Reference>
    <Compile Include="SERVICES/NativeTown.cs" />
    <Compile Include="SERVICES/NativeTownPopulation*.cs" Exclude="SERVICES/NativeTownPopulationLifecycle.cs" />
    <Compile Include="SERVICES/NativeTownHouseDoors.cs" />
    <Compile Include="SERVICES/NativeTownRoleSeed.cs" />
    <Compile Include="SERVICES/NativeTownBackGeometry.cs" />
    <Compile Include="SERVICES/NativeTownWorkshopsPopulation.cs" />
    <Compile Include="SERVICES/NativeTownAssets.cs" />
    <Compile Include="SERVICES/NativeTownTransportPopulation*.cs" />
    <Compile Include="SERVICES/NativeTownLampsPopulation.cs" />
    <Compile Include="SERVICES/NativeTownLampPlanner*.cs" />
    <Compile Include="SERVICES/NativeTownWalkPath.cs" />
    <Compile Include="SERVICES/NativeShops.cs" />
    <Compile Include="SERVICES/NativeGoods.cs" />
  </ItemGroup>
'@
$project=$project.Replace('</Project>',$extras.Replace('ASSEMBLIES',$assemblies).Replace('SERVICES',$services)+'</Project>')
if($Proof -eq 'Lifecycle'){
    $additions=@('NativeTownPopulationLifecycle.cs','NativeTownPressPopulation.cs','NativeTownHomesPopulation.cs','NativeTownVisitorsPopulation.cs','NativeTownEmigrantsPopulation.cs','NativeTownLandmarksPopulation.cs','NativeTownLivelyPopulation*.cs','NativeTownNightPopulation.cs','NativeTownShopsPopulation.cs','NativeTownCafesPopulation.cs','NativeTownBackPopulation*.cs','NativeTownStandingPopulation.cs','NativeTownWallPopulation.cs','NativeTownMillsPopulation.cs','NativeTownRoundPlanner.cs','NativeActions*.cs','NativeEmigrants.cs','NativeEmigrants.Lifecycle.cs','NativeEmigrants.Generation.cs')
    foreach($name in $additions){$project=$project.Replace('</Project>','<ItemGroup><Compile Include="'+$services+'/'+$name+'" /></ItemGroup></Project>')}
}
Set-Content -LiteralPath (Join-Path $folder 'OuterProof.csproj') -Value $project -Encoding utf8
$proofType=if($Proof -eq 'Lifecycle'){'NativePopulationLifecycleProof'}else{'Native'+$Proof+'PopulationProof'}
$program=Get-Content -LiteralPath (Join-Path $workspace ('native-godot/src/Services/'+$proofType+'.cs')) -Raw
$program=$program.Replace('public partial class '+$proofType+' : Node','public static class '+$proofType).Replace('public override void _Ready()','public static void Main(string[] args)').Replace('var args = OS.GetCmdlineUserArgs();','').Replace('ProjectSettings.GlobalizePath(', 'Globalize(').Replace('GD.Print(','Console.WriteLine(').Replace('GD.PushError(','Console.Error.WriteLine(').Replace('GetTree().Quit();','').Replace('GetTree().Quit(1);','System.Environment.Exit(1);').Replace('NativePopulationProof.Difference','Difference')
$difference=Get-Content -LiteralPath (Join-Path $workspace 'native-godot/src/Services/NativePopulationProof.cs') -Raw
$difference=$difference.Substring($difference.IndexOf('    internal static string? Difference'),$difference.IndexOf('    public override void _Ready()')-$difference.IndexOf('    internal static string? Difference'))
$helper='    private static string Globalize(string path)=>Path.Combine("'+$workspace.Replace('\','/')+'/native-godot",path.StartsWith("res://")?path[6..]:path);'+[Environment]::NewLine+$difference
$program=$program.Insert($program.LastIndexOf('}'),$helper)
Set-Content -LiteralPath (Join-Path $folder 'Program.cs') -Value $program -Encoding utf8
$folderName=if($Proof -eq 'Lifecycle'){'native-population-lifecycle'}else{'native-'+$Proof.ToLower()+'-population'}
$output=Join-Path $workspace ('native-godot/proof/'+$folderName+'/result.json')
$recordArgument=@()
if($Record){if($Proof -ne 'Lifecycle'){throw '-Record applies to the lifecycle proof only.'};$recordArgument+='record'}
& dotnet run --project (Join-Path $folder 'OuterProof.csproj') -- $output (Join-Path $workspace 'native-godot/services/data') $recordArgument
if($LASTEXITCODE -ne 0){throw 'Native outer population proof failed.'}
