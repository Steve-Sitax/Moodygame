param([string]$Project=(Join-Path $PSScriptRoot '..'))
$ErrorActionPreference='Stop'
$Project=[IO.Path]::GetFullPath($Project)
$proof=Join-Path $Project ('proof/aspnet-editor-'+[Guid]::NewGuid().ToString('N'))
$library=Join-Path $proof 'library';$runner=Join-Path $proof 'runner'
[void](New-Item -ItemType Directory -Path $library,$runner -Force)
[xml]$native=Get-Content -LiteralPath (Join-Path $Project 'Scheldemist.Native.csproj') -Raw
$runtimeVersion=$native.Project.PropertyGroup.NativeAspNetRuntimeVersion
$runtimeTarget=@($native.Project.Target | Where-Object Name -eq 'NativeAspNetEditorReferences')[0].OuterXml
$download=@($native.Project.ItemGroup | Where-Object { $_.PackageDownload })[0].OuterXml
[IO.File]::WriteAllText((Join-Path $library 'Trial.csproj'),@"
<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework><EnableDynamicLoading>true</EnableDynamicLoading><Nullable>enable</Nullable><NativeAspNetRuntimeVersion>$runtimeVersion</NativeAspNetRuntimeVersion><NativeAspNetEditorRid>`$(NETCoreSdkRuntimeIdentifier)</NativeAspNetEditorRid></PropertyGroup><ItemGroup><FrameworkReference Include="Microsoft.AspNetCore.App"/></ItemGroup>$download$runtimeTarget</Project>
"@)
[IO.File]::WriteAllText((Join-Path $library 'Trial.cs'),@'
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
public static class Trial {
 public static string Probe() {
  var builder=WebApplication.CreateSlimBuilder(new WebApplicationOptions { Args=System.Array.Empty<string>(), ApplicationName=typeof(Trial).Assembly.GetName().Name });
  builder.Logging.ClearProviders(); builder.WebHost.ConfigureKestrel(options=>options.Listen(System.Net.IPAddress.Loopback,0));
  var app=builder.Build(); app.Run(context=>context.Response.WriteAsync("native editor Kestrel"));
  app.StartAsync().GetAwaiter().GetResult();
  string address=System.Linq.Enumerable.First(app.Urls);
  using var http=new System.Net.Http.HttpClient(); string result=http.GetStringAsync(address).GetAwaiter().GetResult();
  app.StopAsync().GetAwaiter().GetResult(); app.DisposeAsync().AsTask().GetAwaiter().GetResult(); return result;
 }
}
'@)
[IO.File]::WriteAllText((Join-Path $runner 'Runner.csproj'),'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework><OutputType>Exe</OutputType><Nullable>enable</Nullable></PropertyGroup></Project>')
[IO.File]::WriteAllText((Join-Path $runner 'Program.cs'),@'
using System;
using System.IO;
using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;
class GodotContext:AssemblyLoadContext {
 readonly AssemblyDependencyResolver resolver; public int Loaded;
 public GodotContext(string path):base(true){resolver=new(path);}
 protected override Assembly? Load(AssemblyName name){string? path=resolver.ResolveAssemblyToPath(name);if(path==null)return null;Loaded++;using var input=File.OpenRead(path);return LoadFromStream(input);}
}
class Program { static void Main(string[] args) {
 string assembly=Path.GetFullPath(args[0]); var context=new GodotContext(assembly);using var input=File.OpenRead(assembly);
 var module=context.LoadFromStream(input);var result=module.GetType("Trial")!.GetMethod("Probe")!.Invoke(null,null);
 if((string?)result!="native editor Kestrel"||context.Loaded<30)throw new Exception("ASP.NET stream-loaded host failed.");
 string receipt=JsonSerializer.Serialize(new{passed=true,privateDependencies=context.Loaded,response=result});
 File.WriteAllText(args[1],receipt);Console.WriteLine(receipt);
} }
'@)
& dotnet build (Join-Path $library 'Trial.csproj') --nologo
if($LASTEXITCODE -ne 0){throw "Native ASP.NET fixture build failed: $proof"}
& dotnet run --project (Join-Path $runner 'Runner.csproj') -- (Join-Path $library 'bin/Debug/net8.0/Trial.dll') (Join-Path $proof 'result.json')
if($LASTEXITCODE -ne 0){throw "Native ASP.NET load fixture failed: $proof"}
Write-Output "Godot-style editor dependency proof: $proof"
