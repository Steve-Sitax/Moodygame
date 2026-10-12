param([Parameter(Mandatory)][string]$Package,[switch]$Server,[int]$Port=18800)
$ErrorActionPreference = 'Stop'
$Package=[IO.Path]::GetFullPath($Package)
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$proof=Join-Path $project ('proof/standalone-'+[Guid]::NewGuid().ToString('N'))
$relocated=Join-Path $proof 'relocated game'
[void](New-Item -ItemType Directory -Path $relocated -Force)
# Copy the actual inventory; user data never enters the relocated package.
foreach($entry in Get-ChildItem -LiteralPath $Package){Copy-Item -LiteralPath $entry.FullName -Destination $relocated -Recurse}
$exe=if($Server){'ScheldemistServer.console.exe'}else{'Scheldemist.exe'}
$start=[Diagnostics.ProcessStartInfo]::new()
$start.FileName=Join-Path $relocated $exe
$start.WorkingDirectory=$relocated
$start.UseShellExecute=$false
$start.CreateNoWindow=$true
$start.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
$start.RedirectStandardOutput=$true
$start.RedirectStandardError=$true
$start.Environment['SCHELDEMIST_ROOT']=Join-Path $proof 'missing legacy source'
$start.Environment['SCHELDEMIST_BAKE']=Join-Path $proof 'missing legacy bake'
$start.Environment['SCHELDEMIST_USER_DATA']=Join-Path $proof 'userdata'
$start.Environment['DOTNET_ROOT']=Join-Path $proof 'missing dotnet'
$start.Environment['DOTNET_ROOT_X64']=Join-Path $proof 'missing dotnet'
$start.Environment['DOTNET_MULTILEVEL_LOOKUP']='0'
$start.Environment['PATH']=Join-Path $env:SystemRoot 'System32'
if($Server){$start.ArgumentList.Add('--headless')}else{$start.ArgumentList.Add('--rendering-method');$start.ArgumentList.Add('forward_plus')}
$liveLog=Join-Path $proof 'live-engine.log'
$start.ArgumentList.Add('--log-file');$start.ArgumentList.Add($liveLog)
$start.ArgumentList.Add('--')
foreach($argument in @('--no-ai','--scene-seed','--author-root',(Join-Path $proof 'layouts'),'--native-data-proof',(Join-Path $proof 'data-result.json'),'--port',$Port.ToString())){$start.ArgumentList.Add($argument)}
if($Server){foreach($argument in @('--dedicated','--server-ready',(Join-Path $proof 'server-ready.json'))){$start.ArgumentList.Add($argument)}}
else{foreach($argument in @('--native-package-smoke',$proof)){$start.ArgumentList.Add($argument)}}
$child=[Diagnostics.Process]::new()
$child.StartInfo=$start
$started=$false
try {
    [void]$child.Start()
    $started=$true
    $stdout=$child.StandardOutput.ReadToEndAsync();$stderr=$child.StandardError.ReadToEndAsync()
    $deadline=[DateTime]::UtcNow.AddSeconds(180)
    if($Server){
        $ready=Join-Path $proof 'server-ready.json'
        while(-not (Test-Path -LiteralPath $ready) -and -not $child.HasExited -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 250}
        if(-not (Test-Path -LiteralPath $ready)){throw 'Relocated native server did not become ready.'}
        $info=Get-Content -LiteralPath $ready -Raw | ConvertFrom-Json
        $response=Invoke-RestMethod -Uri ($info.url+'/api/mp/info') -TimeoutSec 10
        $data=Get-Content -LiteralPath (Join-Path $proof 'data-result.json') -Raw | ConvertFrom-Json
        if(-not $response -or $info.fingerprint -notmatch '^[a-f0-9]{64}$'){throw 'Relocated native server endpoint did not answer.'}
        [ordered]@{passed=$true;server=$true;fingerprint=$info.fingerprint;files=$data.Files;extracted=$data.Extracted;url=$info.url} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $proof 'result.json') -Encoding utf8
        $child.Kill($true);$child.WaitForExit()
    }else{
        while(-not $child.HasExited -and [DateTime]::UtcNow -lt $deadline){
            Start-Sleep -Milliseconds 250
            if(Test-Path -LiteralPath $liveLog){
                $tail=(Get-Content -LiteralPath $liveLog -Tail 100 -ErrorAction SilentlyContinue) -join "`n"
                if($tail -match 'NativeCourtyards' -and $tail -match 'System\.InvalidOperationException'){throw 'This package contains the already-identified courtyard exception; stop and rebuild after its fix.'}
            }
        }
        if(-not $child.HasExited){throw 'Relocated native game exceeded its proof deadline.'}
        if($child.ExitCode -ne 0){throw "Relocated native game exited $($child.ExitCode)."}
    }
    $result=Get-Content -LiteralPath (Join-Path $proof 'result.json') -Raw | ConvertFrom-Json
    if(-not $result.passed){throw 'Exported runtime proof did not pass.'}
    $data=Get-Content -LiteralPath (Join-Path $proof 'data-result.json') -Raw | ConvertFrom-Json
    if(-not $data.Extracted -or $data.Files -lt 300){throw 'Cold native data extraction was not proven.'}
    Write-Output "Relocated native package PASS: $proof"
}
finally {
    $log=''
    if($started){
        if(-not $child.HasExited){$child.Kill($true);$child.WaitForExit()}
        $log=$stdout.GetAwaiter().GetResult()+$stderr.GetAwaiter().GetResult()
        [IO.File]::WriteAllText((Join-Path $proof 'engine.log'),$log)
    }
    $child.Dispose()
    if($log -match '(?m)^ERROR:|Unhandled exception|System\.IO\.FileNotFoundException'){throw "Exported runtime logged errors: $proof"}
}
