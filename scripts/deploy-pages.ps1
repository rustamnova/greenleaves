[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$stopCode = [DateTimeOffset]::Parse('2026-09-29T23:59:00+03:00')
if ([DateTimeOffset]::UtcNow -ge $stopCode) { throw 'Stop-code reached. Do not update submitted code, site or materials.' }
$repoRoot = Split-Path $PSScriptRoot -Parent
Push-Location $repoRoot
try {
    # Only the committed site subtree is published; private/unrelated files stay local.
    git diff --exit-code HEAD -- site
    if ($LASTEXITCODE -ne 0) { throw 'Review and commit website changes before publishing.' }
    node --test tests/engine.test.mjs tests/cli.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
    $pagesCommit = git subtree split --prefix site HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Site subtree export failed.' }
    # Retain published history. No force-push and no automatic deployment.
    if ([DateTimeOffset]::UtcNow -ge $stopCode) { throw 'Stop-code reached. Publication is frozen.' }
    git push origin "${pagesCommit}:refs/heads/gh-pages"
    if ($LASTEXITCODE -ne 0) { throw 'Pages push failed.' }
    Write-Output "Published site commit: $pagesCommit"
} finally { Pop-Location }
