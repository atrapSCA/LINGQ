$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

$manifest = Get-Content -LiteralPath (Join-Path $root "manifest.json") -Raw -Encoding UTF8
$version = [regex]::Match($manifest, '"version"\s*:\s*"([^"]+)"').Groups[1].Value
if (-not $version) {
  throw "V manifest.json chybí číslo verze."
}

$tag = "v$version"
$existing = git rev-parse -q --verify "refs/tags/$tag" 2>$null
if ($LASTEXITCODE -eq 0 -and $existing) {
  throw "Tag $tag už existuje. Nejdřív zvyš verzi v manifest.json a ZMENY.txt."
}

git add -A
$status = git status --porcelain
if (-not $status) {
  throw "Není co commitnout. Udělej změny a zvyš verzi před uložením."
}

$summary = "Verze $version"
$zmenyPath = Join-Path $root "ZMENY.txt"
if (Test-Path -LiteralPath $zmenyPath) {
  $lines = Get-Content -LiteralPath $zmenyPath -Encoding UTF8
  $bullets = @()
  $inBlock = $false
  foreach ($line in $lines) {
    if ($line -match "^Verze\s+$([regex]::Escape($version))\s*$") {
      $inBlock = $true
      continue
    }
    if ($inBlock) {
      if ($line -match "^Verze\s+") { break }
      if ($line -match "^\s*-\s+(.+)$") { $bullets += $Matches[1].Trim() }
    }
  }
  if ($bullets.Count -gt 0) {
    $summary = ($bullets | Select-Object -First 3) -join "; "
  }
}

$message = @"
$summary

Verze $version
"@

git commit -m $message
if ($LASTEXITCODE -ne 0) { throw "Commit selhal." }

git tag -a $tag -m "Verze $version"
if ($LASTEXITCODE -ne 0) { throw "Vytvoření tagu $tag selhalo." }

$remote = git remote get-url origin 2>$null
if ($LASTEXITCODE -eq 0 -and $remote) {
  git push -u origin HEAD
  if ($LASTEXITCODE -ne 0) { throw "Push na origin selhal." }
  git push origin $tag
  if ($LASTEXITCODE -ne 0) { throw "Push tagu $tag selhal." }
  Write-Output "Uložena verze $version (tag $tag) a odeslána na GitHub."
} else {
  Write-Output "Uložena verze $version (tag $tag) lokálně. Remote origin zatím chybí — po napojení na GitHub spusť: git push -u origin HEAD; git push --tags"
}
