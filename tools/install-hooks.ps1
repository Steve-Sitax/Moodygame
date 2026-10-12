$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location $workspace
try {
    if((& git config extensions.worktreeConfig) -ne 'true'){throw 'Enable worktree-specific Git configuration before installing this hook.'}
    & git config --worktree core.hooksPath .githooks
    if($LASTEXITCODE -ne 0){throw 'Could not configure this worktree hook.'}
    Write-Output 'Native privacy hook enabled for this worktree only; shared/main hooks remain unchanged.'
} finally {Pop-Location}
