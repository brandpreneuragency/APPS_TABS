[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$acceptanceRoot = Join-Path $env:LOCALAPPDATA 'TABS-Clients-Acceptance\cargo-target'
$acceptanceExe = Join-Path $acceptanceRoot 'release\tabs.exe'
$running = @(Get-Process -Name tabs -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $acceptanceExe })
if ($running.Count -gt 0) { throw 'Quit only TABS Clients Acceptance before rebuilding it.' }
$previousTarget = $env:CARGO_TARGET_DIR
$previousConfig = $env:TAURI_CONFIG
Push-Location -LiteralPath $repoRoot
try {
    $env:CARGO_TARGET_DIR = $acceptanceRoot
    $env:TAURI_CONFIG = $null
    & npm.cmd run tauri -- build --no-bundle --features clients-acceptance --config (Join-Path $repoRoot 'src-tauri\tauri.clients-acceptance.conf.json')
    if ($LASTEXITCODE -ne 0) { throw 'Native acceptance build failed.' }
    if (-not (Test-Path -LiteralPath $acceptanceExe -PathType Leaf)) { throw 'The expected acceptance executable was not produced.' }
    Write-Output ('Acceptance executable: ' + $acceptanceExe)
    Write-Output ('SHA256: ' + (Get-FileHash -LiteralPath $acceptanceExe -Algorithm SHA256).Hash.ToLowerInvariant())
} finally {
    $env:CARGO_TARGET_DIR = $previousTarget
    $env:TAURI_CONFIG = $previousConfig
    Pop-Location
}
