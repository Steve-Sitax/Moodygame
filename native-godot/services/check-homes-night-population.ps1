param([switch]$RefreshLegacyOracles)
if($RefreshLegacyOracles){& node (Join-Path $PSScriptRoot 'homes-night-population-oracles.mts');if($LASTEXITCODE -ne 0){throw 'Original homes/night fixture recovery failed.'}}
& (Join-Path $PSScriptRoot 'check-shop-population.ps1') -HomesNight
if($LASTEXITCODE -ne 0){throw 'Native homes/night population proof failed.'}
