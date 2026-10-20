[CmdletBinding()]
param(
    [string]$PackageRoot,
    [string]$RepoRoot = 'C:\Users\burak\MOTHER\PROJECTS\TABS-local',
    [switch]$FingerprintOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($PackageRoot)) {
    $PackageRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

function Need([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Sha([string]$Path) {
    Need (Test-Path -LiteralPath $Path -PathType Leaf) 'Required evidence or executable is missing.'
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Json([string]$Path) {
    Need (Test-Path -LiteralPath $Path -PathType Leaf) 'Receipt/evidence is missing; preflight has not passed.'
    try { return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { throw 'Receipt/evidence is not valid JSON.' }
}
function Full([string]$Path) {
    Need (-not [string]::IsNullOrWhiteSpace($Path)) 'A required path is missing.'
    return [IO.Path]::GetFullPath($Path)
}
function Inside([string]$Path, [string]$Root) {
    $resolvedRoot = (Full $Root).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    return (Full $Path).StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)
}
function DateUtc([string]$Value) {
    Need (-not [string]::IsNullOrWhiteSpace($Value)) 'Required timestamp is missing.'
    return [DateTimeOffset]::Parse($Value).ToUniversalTime()
}
function Candidate([string]$Root, [switch]$AdapterOnly) {
    $specs = if ($AdapterOnly) {
        @('src-tauri/src/gmail','src/services/gmail','src/types/gmail.ts','src-tauri/Cargo.toml','src-tauri/Cargo.lock')
    } else {
        @('src','src-tauri','scripts','public','package.json','package-lock.json',
          'index.html','tsconfig*.json','vite.config.*','vitest.config.*','eslint.config.*')
    }
    $items = @(& git -C $Root ls-files --cached --others --exclude-standard -- @specs)
    Need ($LASTEXITCODE -eq 0) 'Cannot enumerate candidate source.'
    $items = @($items | Where-Object { $_ -and $_ -notmatch '(^|/)(target|node_modules|dist|TASKS)(/|$)' } | Sort-Object -Unique)
    Need ($items.Count -gt 0) 'Candidate source is empty.'
    $lines = foreach ($item in $items) {
        $path = Full (Join-Path $Root $item)
        Need (Inside $path $Root) 'Candidate source escaped the repository.'
        $hash = if (Test-Path -LiteralPath $path -PathType Leaf) { Sha $path } else { 'MISSING' }
        $item.Replace('\', '/') + '=' + $hash
    }
    $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join [char]10))
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}
try {
    $candidate = Candidate $RepoRoot
    if ($FingerprintOnly) { Write-Output $candidate; exit 0 }
    $receipt = Json (Join-Path $PackageRoot 'preflight-receipt.json')
    Need ($receipt.schemaVersion -eq 1) 'Unsupported receipt schema.'
    Need ($receipt.status -eq 'passed') 'Preflight is not passed.'
    $now = [DateTimeOffset]::UtcNow
    $checked = DateUtc $receipt.checkedAt
    Need (($now - $checked).TotalHours -ge 0 -and ($now - $checked).TotalHours -le 24) 'Preflight receipt is stale.'
    Need ($receipt.repoCandidateFingerprint -eq $candidate) 'Source changed since preflight; revalidate the candidate.'
    Need ($receipt.adapterContractVersion -eq 'CL-C1') 'Contract version mismatch.'
    Need ($receipt.contractSha256 -eq (Sha (Join-Path $PackageRoot '03-contracts.md'))) 'Contract content changed.'
    Need ($receipt.adapterFingerprint -eq (Candidate $RepoRoot -AdapterOnly)) 'Gmail adapter changed since preflight.'
    Need (@($receipt.prerequisiteFailures).Count -eq 0) 'Preflight has unresolved prerequisites.'

    $identity = $receipt.isolatedAppIdentity
    Need ($identity.identifier -eq 'com.tabs.clients.acceptance') 'Acceptance identifier mismatch.'
    $buildRoot = Join-Path $env:LOCALAPPDATA 'TABS-Clients-Acceptance\cargo-target'
    $privateRoot = Join-Path $env:LOCALAPPDATA 'com.tabs.clients.acceptance\clients\acceptance'
    Need (Inside $identity.executablePath $buildRoot) 'Executable is outside the acceptance build root.'
    Need ((Full $identity.privateRoot) -eq (Full $privateRoot)) 'Private acceptance root mismatch.'
    Need ((Full $identity.configPath) -eq (Full (Join-Path $RepoRoot 'src-tauri\tauri.clients-acceptance.conf.json'))) 'Unexpected config path.'
    Need ((Sha $identity.executablePath) -eq $identity.executableSha256) 'Executable hash mismatch.'
    Need ((Sha $identity.configPath) -eq $identity.configSha256) 'Configuration hash mismatch.'
    $config = Json $identity.configPath
    Need ($config.identifier -eq $identity.identifier) 'Configuration identifier mismatch.'
    Need ($config.bundle.active -eq $false -and $config.bundle.createUpdaterArtifacts -eq $false) 'Bundling/updater artifacts are enabled.'
    Need (@($config.bundle.fileAssociations).Count -eq 0) 'Acceptance file associations are not empty.'

    $isolation = @('identifier','appData','appLocalData','appConfig','webviewProfile','dexieStorage',
        'gmailCredentialNamespace','journals','singleInstance','shortcut','tray','associations','updater','productionProcesses')
    foreach ($name in $isolation) { Need ($receipt.isolationChecks.$name -eq $true) ('Missing isolation proof: ' + $name) }
    $scopes = @('https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send')
    Need ($receipt.requiredScopesVerified.grantsVerified -eq $true) 'OAuth grants are not verified.'
    Need (@($receipt.requiredScopesVerified.scopes).Count -eq 2) 'Unexpected OAuth scope set.'
    foreach ($scope in $scopes) { Need ($receipt.requiredScopesVerified.scopes -contains $scope) 'A required scope is missing.' }
    Need ($receipt.refreshAfterRestartVerified -eq $true) 'Restart and refresh proof is missing.'
    Need ($receipt.gmailReadStateUnchanged -eq $true) 'Gmail read-state proof is missing.'
    Need ($receipt.attachmentResult -eq 'passed' -and $receipt.freshStartAndDeduplicationResult -eq 'passed') 'Attachment/fresh-start proof is missing.'
    foreach ($op in @('read','send','reply','replyAll','forward')) {
        Need ($receipt.liveReadSendReplyReplyAllForwardResults.$op -eq 'passed') ('Missing live proof: ' + $op)
    }
    $validity = $receipt.credentialValidityAssessment
    Need ($validity.noPlannedReauth -eq $true -and $validity.policyReviewed -eq $true) 'Credential validity is not resolved.'
    $runUntil = DateUtc $validity.plannedRunUntilUtc
    Need ($runUntil -gt $now) 'The planned run window expired.'
    if ($validity.knownExpiryUtc) { Need ((DateUtc $validity.knownExpiryUtc) -gt $runUntil.AddHours(24)) 'Known token expiry is too close.' }

    $proofs = @('PF-OAUTH','PF-IDENTITY','PF-RESTART','PF-REFRESH','PF-READ','PF-NEW','PF-REPLY',
        'PF-REPLYALL','PF-FORWARD','PF-READSTATE','PF-FRESH','PF-ISOLATION','PF-PERMITS')
    foreach ($proof in $proofs) {
        $refs = @($receipt.evidence | Where-Object { $_.id -eq $proof })
        Need ($refs.Count -eq 1) ('Missing/duplicate proof: ' + $proof)
        $ref = $refs[0]
        Need (-not [IO.Path]::IsPathRooted($ref.path)) 'Evidence path must be relative.'
        $path = Full (Join-Path $PackageRoot $ref.path)
        Need (Inside $path (Join-Path $PackageRoot 'reports')) 'Evidence path escaped reports.'
        Need ((Sha $path) -eq $ref.sha256) ('Evidence hash mismatch: ' + $proof)
        $result = Json $path
        Need ($result.evidenceId -eq $proof -and $result.status -eq 'passed') ('Evidence did not pass: ' + $proof)
        Need ($result.candidateFingerprint -eq $candidate -and $result.executableSha256 -eq $identity.executableSha256) 'Evidence candidate mismatch.'
        Need ($result.adapterContractVersion -eq $receipt.adapterContractVersion) 'Evidence contract mismatch.'
        $assertions = @($result.assertions)
        Need ($assertions.Count -gt 0) 'Evidence has no executable assertions.'
        Need (@($assertions | Where-Object { $_.status -ne 'passed' }).Count -eq 0) 'An evidence assertion failed.'
    }
    $suite = $receipt.permittedTestSuiteReference
    Need (Inside $suite.privateConfigPath $privateRoot) 'Fixture config is outside acceptance storage.'
    Need ((Sha $suite.privateConfigPath) -eq $suite.sha256) 'Fixture permission configuration changed.'

    # P1 implements this helper. Readiness must never send mail.
    $runner = Join-Path $RepoRoot 'scripts\clients\Invoke-ClientsReadiness.ps1'
    Need (Test-Path -LiteralPath $runner -PathType Leaf) 'Native readiness helper is not implemented.'
    Need (Test-Path -LiteralPath $privateRoot -PathType Container) 'Acceptance storage has not been prepared.'
    $nonce = [Guid]::NewGuid().ToString('N')
    $freshPath = Join-Path $privateRoot ('readiness-' + $nonce + '.json')
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner -ExecutablePath $identity.executablePath -Nonce $nonce -OutputPath $freshPath -NoSend *> $null
    Need ($LASTEXITCODE -eq 0) 'Fresh native readiness failed; inspect sanitized private diagnostics.'
    $fresh = Json $freshPath
    Need ($fresh.schemaVersion -eq 1 -and $fresh.status -eq 'passed' -and $fresh.nonce -eq $nonce) 'Fresh readiness result is invalid.'
    Need ($fresh.executableSha256 -eq $identity.executableSha256 -and $fresh.identifier -eq $identity.identifier) 'Fresh probe runtime mismatch.'
    $age = ([DateTimeOffset]::UtcNow - (DateUtc $fresh.checkedAt)).TotalSeconds
    Need ($age -ge 0 -and $age -le 120) 'Fresh readiness result is stale.'
    foreach ($name in $isolation) { Need ($fresh.isolationChecks.$name -eq $true) ('Fresh isolation failed: ' + $name) }
    foreach ($name in @('forcedRefresh','profileRead','sameMailbox','receiverObserverReady','permitAuthorized','noSendPerformed')) {
        Need ($fresh.proof.$name -eq $true) ('Fresh readiness proof missing: ' + $name)
    }
    Need ($fresh.permit.remainingSends -ge 4) 'Insufficient permitted sends for the final suite.'
    Need ((DateUtc $fresh.permit.expiresAt) -gt $runUntil) 'Test permission expires before the run window.'
    Write-Output ('PASS: attended proof and fresh no-send native readiness verified; candidate=' + $candidate)
    exit 0
} catch {
    # No raw provider response or private JSON is emitted.
    Write-Output ('BLOCKED: ' + $_.Exception.Message)
    exit 2
}
