[CmdletBinding()]
param([string]$CliPath = $env:NETLIFY_CLI_PATH)

$ErrorActionPreference = 'Stop'
$stopCode = [DateTimeOffset]::Parse('2026-09-29T23:59:00+03:00')
if ([DateTimeOffset]::UtcNow -ge $stopCode) { throw 'Contest stop-code reached. Publication is frozen.' }
$repoRoot = Split-Path $PSScriptRoot -Parent
Push-Location $repoRoot
try {
    git diff --exit-code HEAD -- site
    if ($LASTEXITCODE -ne 0) { throw 'Review and commit website changes before publishing.' }
    node --test tests/engine.test.mjs tests/cli.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
    $payloadJson = & node scripts/prepare-hosting.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Website export failed.' }
    $payload = $payloadJson | ConvertFrom-Json
    $publishDir = Join-Path $payload.output 'netlify'
    $releaseRef = git rev-parse --short HEAD
    if ([DateTimeOffset]::UtcNow -ge $stopCode) { throw 'Contest stop-code reached. Publication is frozen.' }
    $deployArgs = @('deploy', '--prod', '--no-build', '--dir', $publishDir, '--site', '83cad17a-cf00-40f0-b26b-6ad97f0e15bf', '--message', "Greenleaves release $releaseRef", '--json')
    if ($CliPath) { & node $CliPath @deployArgs }
    else { & netlify @deployArgs }
    if ($LASTEXITCODE -ne 0) { throw 'Netlify deployment failed. Inspect its status before retrying.' }
} finally { Pop-Location }
