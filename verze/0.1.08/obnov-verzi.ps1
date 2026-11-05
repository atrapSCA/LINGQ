param(
  [Parameter(Mandatory = $true)]
  [string]$Verze
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceDir = Join-Path $root "verze\$Verze"
if (-not (Test-Path -LiteralPath $sourceDir)) {
  throw "Verze $Verze není uložená. Složka verze\$Verze neexistuje."
}

Get-ChildItem -LiteralPath $sourceDir -File | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $root $_.Name) -Force
}

$icons = Join-Path $sourceDir "icons"
if (Test-Path -LiteralPath $icons) {
  Copy-Item -LiteralPath $icons -Destination (Join-Path $root "icons") -Recurse -Force
}

Write-Output "Obnovena verze $Verze. V Chrome na chrome://extensions doplněk znovu načtěte."
