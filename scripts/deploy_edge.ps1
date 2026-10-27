# PowerShell wrapper for Alpha Engine Edge Deployer
param(
    [switch]$WithStandby,
    [switch]$SkipLint,
    [switch]$SkipPush,
    [switch]$DryRun
)

$nodeArgs = @("$PSScriptRoot/deploy_edge.cjs")
if ($WithStandby) { $nodeArgs += "--with-standby" }
if ($SkipLint)    { $nodeArgs += "--skip-lint" }
if ($SkipPush)    { $nodeArgs += "--skip-push" }
if ($DryRun)      { $nodeArgs += "--dry-run" }

& node @nodeArgs
exit $LASTEXITCODE
