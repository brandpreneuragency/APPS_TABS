[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# This launcher never opens the installed TABS executable or starts OAuth itself.
$acceptanceRoot = Join-Path $env:LOCALAPPDATA 'TABS-Clients-Acceptance\cargo-target'
$acceptanceExe = Join-Path $acceptanceRoot 'release\tabs.exe'
if (-not (Test-Path -LiteralPath $acceptanceExe -PathType Leaf)) {
    throw 'The isolated acceptance executable has not been built.'
}
$process = Start-Process -FilePath $acceptanceExe -WorkingDirectory (Split-Path -Parent $acceptanceExe) -WindowStyle Normal -PassThru
Write-Output ('Started TABS Clients Acceptance; process ID: ' + $process.Id)
