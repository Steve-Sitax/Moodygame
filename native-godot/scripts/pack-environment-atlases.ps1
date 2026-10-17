$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$photo = Join-Path $env:LOCALAPPDATA 'Programs/Photocraft/photocraft-cli.exe'
$source = Join-Path $root 'art-source/environment-20261013'
$output = Join-Path $root 'native-godot/assets/materials/environment-20261013'
$parts = Join-Path $root 'native-godot/proof/environment-textures/atlas-parts'
New-Item -ItemType Directory -Force $parts | Out-Null
function Crop-Part($name, $inputFile, $rect, $width, $height) {
    $crop = @{x=$rect[0];y=$rect[1];width=$rect[2];height=$rect[3]} | ConvertTo-Json -Compress
    $size = @{width=$width;height=$height;resample='lanczos'} | ConvertTo-Json -Compress
    $target = Join-Path $parts "$name.png"
    & $photo run $inputFile --cmd image.crop --params $crop --cmd image.imageSize --params $size --out $target | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Photocraft failed: $name" }
    return $target
}
$roofParts = @(
    (Crop-Part 'roof-clay' "$source/clay-v2.png" @(0,0,1254,1254) 512 512),
    (Crop-Part 'roof-slate' "$source/slate-v3.png" @(0,0,1254,1254) 512 512),
    (Crop-Part 'roof-lead' "$source/roof-atlas-source.png" @(0,627,627,627) 512 512),
    (Crop-Part 'roof-flat' "$source/roof-atlas-source.png" @(627,627,627,627) 512 512)
)
$arguments = @('run','--new','{"width":1024,"height":1024,"background":"black"}')
for ($i=0; $i -lt 4; $i++) {
    $parameters = @{path=$roofParts[$i];fit=$false;center=@((256+512*($i%2)),(256+512*[math]::Floor($i/2)))} | ConvertTo-Json -Compress
    $arguments += @('--cmd','file.placeEmbedded','--params',$parameters)
}
$arguments += @('--out',"$output/house-roofs.png")
& $photo @arguments | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Photocraft roof assembly failed' }

# Preserve every original UV cell; only replace identified materials with matching
# photographs. Fish, shell interiors and other specialised pictorial cells stay intact.
$debris = @(
    @('wood','$wood',@(0,0,2048,683),@(32,32,32,16)),
    @('wood-grey','$wood',@(50,180,1800,450),@(64,32,32,16)),
    @('wood-dark','$v2',@(667,234,218,132),@(96,32,32,16)),
    @('jute','$v1',@(1332,2,218,288),@(192,0,32,32)),
    @('rag-red','$v2',@(1111,234,106,131),@(160,32,16,16)),
    @('rag-blue','$v2',@(1222,234,106,131),@(176,32,16,16)),
    @('rag-grey','$v2',@(1333,234,106,131),@(192,32,16,16)),
    @('leaves','$v2',@(2,234,216,260),@(0,32,32,32)),
    @('straw','$v2',@(445,2,217,226),@(64,0,32,32)),
    @('dung','$v1',@(2,2,216,288),@(0,0,32,32))
)
$arguments = @('run',"$source/debris-original.png",'--cmd','image.imageSize','--params','{"width":4096,"height":2048,"resample":"nearest"}')
foreach ($part in $debris) {
    $inputFile = if ($part[1] -eq '$wood') { "$source/wood-v3.png" } elseif ($part[1] -eq '$v1') { "$source/debris-atlas-source.png" } else { "$source/debris-v2.png" }
    $rect=$part[3]
    $target=Crop-Part ('debris-'+$part[0]) $inputFile $part[2] ($rect[2]*16) ($rect[3]*16)
    $parameters=@{path=$target;fit=$false;center=@((($rect[0]+$rect[2]/2)*16),(($rect[1]+$rect[3]/2)*16))}|ConvertTo-Json -Compress
    $arguments += @('--cmd','file.placeEmbedded','--params',$parameters)
}
$arguments += @('--out',"$output/debris.png")
& $photo @arguments | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Photocraft debris assembly failed' }
Write-Output 'Photocraft packed roof atlas and ten debris material cells with fixed original UV boundaries.'



