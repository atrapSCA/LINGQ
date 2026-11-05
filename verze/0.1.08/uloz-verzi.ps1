$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Get-Content -LiteralPath (Join-Path $root "manifest.json") -Raw -Encoding UTF8
$version = [regex]::Match($manifest, '"version"\s*:\s*"([^"]+)"').Groups[1].Value
if (-not $version) {
  throw "V manifest.json chybí číslo verze."
}

$dest = Join-Path $root "verze\$version"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$files = @(
  "background.js", "content.css", "content.js", "manifest.json",
  "popup.css", "popup.html", "popup.js", "README.md", "ZMENY.txt",
  "index.js", "package.json", "package-lock.json", ".gitignore",
  "uloz-verzi.ps1", "obnov-verzi.ps1"
)

foreach ($file in $files) {
  $source = Join-Path $root $file
  if (Test-Path -LiteralPath $source) {
    Copy-Item -LiteralPath $source -Destination (Join-Path $dest $file) -Force
  }
}

$icons = Join-Path $root "icons"
if (Test-Path -LiteralPath $icons) {
  Copy-Item -LiteralPath $icons -Destination (Join-Path $dest "icons") -Recurse -Force
}

Write-Output "Uložena verze $version do verze\$version"
