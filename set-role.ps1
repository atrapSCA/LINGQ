param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('admin', 'user')]
  [string]$Role
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

$rolePath = Join-Path $root 'role.js'
$manifestPath = Join-Path $root 'manifest.json'

$roleJs = @"
// Role buildu doplňku.
// - 'admin'  = včetně automatických kontrolních dotazů na LingQ při nečinnosti
// - 'user'  = veřejná verze bez idle probe
// Přepnutí: powershell -File set-role.ps1 -Role admin|user
const EXTENSION_ROLE = '$Role';

function isAdminBuild() {
  return EXTENSION_ROLE === 'admin';
}
"@
Set-Content -LiteralPath $rolePath -Value $roleJs -Encoding UTF8

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
if ($Role -eq 'admin') {
  $name = 'LingQ Click Translator (Admin)'
  $title = 'LingQ Click Translator (Admin)'
} else {
  $name = 'LingQ Click Translator'
  $title = 'LingQ Click Translator'
}

$manifest = [regex]::Replace($manifest, '"name"\s*:\s*"[^"]*"', '"name": "' + $name + '"')
$manifest = [regex]::Replace($manifest, '"default_title"\s*:\s*"[^"]*"', '"default_title": "' + $title + '"')
Set-Content -LiteralPath $manifestPath -Value ($manifest.TrimEnd() + "`n") -Encoding UTF8

Write-Output "Role nastavena na: $Role"
Write-Output "Manifest name: $name"
Write-Output "Znovu načtěte doplněk v chrome://extensions"
