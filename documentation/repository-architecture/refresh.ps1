[CmdletBinding()]
param(
    [switch]$Check
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$generator = Join-Path $repoRoot ".github\extensions\repository-architecture\generate-static.mjs"
$testDirectory = Join-Path $repoRoot ".github\extensions\repository-architecture\test"
$output = "documentation\repository-architecture\index.html"
$nodeArguments = @(
    $generator
    "--repo-root"
    $repoRoot
    "--output"
    $output
)

if ($Check) {
    $nodeArguments += "--check"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is required to refresh the repository architecture page."
}

Push-Location $repoRoot
try {
    $testFiles = Get-ChildItem $testDirectory -Filter "*.test.mjs" -File |
        Sort-Object FullName |
        Select-Object -ExpandProperty FullName

    if (-not $testFiles) {
        throw "No repository architecture tests were found."
    }

    & node --test --test-concurrency=1 @testFiles
    if ($LASTEXITCODE -ne 0) {
        throw "Repository architecture tests failed with exit code $LASTEXITCODE."
    }

    & node @nodeArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Repository architecture refresh failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
