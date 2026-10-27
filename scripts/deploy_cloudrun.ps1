# PowerShell wrapper for Alpha Engine Cloud Run Standby Deployer
& node "$PSScriptRoot/deploy_cloudrun.cjs" @args
exit $LASTEXITCODE
