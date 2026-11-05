param(
  [Parameter(Mandatory = $true)]
  [string]$Verze
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

$tag = if ($Verze.StartsWith("v")) { $Verze } else { "v$Verze" }
$versionFolder = $Verze -replace "^v", ""

$tagExists = git rev-parse -q --verify "refs/tags/$tag" 2>$null
if ($LASTEXITCODE -eq 0 -and $tagExists) {
  git checkout $tag -- .
  if ($LASTEXITCODE -ne 0) { throw "Obnova z tagu $tag selhala." }
  Write-Output "Obnovena verze $versionFolder z git tagu $tag. V Chrome na chrome://extensions doplněk znovu načtěte."
  return
}

$sourceDir = Join-Path $root "verze\$versionFolder"
if (-not (Test-Path -LiteralPath $sourceDir)) {
  throw "Verze $versionFolder není v gitu (tag $tag) ani ve složce verze\$versionFolder."
}

Get-ChildItem -LiteralPath $sourceDir -File | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $root $_.Name) -Force
}

$icons = Join-Path $sourceDir "icons"
if (Test-Path -LiteralPath $icons) {
  Copy-Item -LiteralPath $icons -Destination (Join-Path $root "icons") -Recurse -Force
}

Write-Output "Obnovena verze $versionFolder ze složky verze. V Chrome na chrome://extensions doplněk znovu načtěte."
