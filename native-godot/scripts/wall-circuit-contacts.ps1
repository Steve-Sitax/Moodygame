param([string]$Mode='candidate',[string]$Pattern='*-day.png')
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../proof/wall-circuit'))
$photo=Join-Path $env:LOCALAPPDATA 'Programs/Photocraft/photocraft-cli.exe'
$dest=Join-Path $root "$Mode-contacts"
New-Item -ItemType Directory -Force $dest | Out-Null
$files=@(Get-ChildItem (Join-Path $root $Mode) -Filter $Pattern | Sort-Object Name)
$index=@()
for($page=0;$page -lt [Math]::Ceiling($files.Count/12);$page++) {
 $arguments=@('run','--new','{"width":2160,"height":1800,"background":"black"}')
 $names=@()
 for($slot=0;$slot -lt 12;$slot++) {
  $i=$page*12+$slot
  if($i -ge $files.Count){break}
  $thumb=Join-Path $dest ('thumb-'+$files[$i].Name)
  & $photo run $files[$i].FullName --cmd image.imageSize --params '{"width":720,"height":450,"resample":"lanczos"}' --out $thumb | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Thumbnail failed'}
  $params=@{path=$thumb;fit=$false;center=@((360+720*($slot%3)),(225+450*[Math]::Floor($slot/3)))}|ConvertTo-Json -Compress
  $arguments+=@('--cmd','file.placeEmbedded','--params',$params)
  $names+=$files[$i].Name
 }
 $name=('sheet-{0:D2}.png' -f $page)
 $arguments+=@('--out',(Join-Path $dest $name))
 & $photo @arguments | Out-Null
 if($LASTEXITCODE -ne 0){throw 'Contact sheet failed'}
 $index+=@{sheet=$name;images=$names}
}
$index|ConvertTo-Json -Depth 4|Set-Content (Join-Path $dest 'index.json')
Write-Output "Created $($index.Count) sheets from $($files.Count) screenshots."
