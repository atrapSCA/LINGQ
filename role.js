// Role buildu doplňku.
// - 'admin'  = včetně automatických kontrolních dotazů na LingQ při nečinnosti
// - 'user'  = veřejná verze bez idle probe
// Přepnutí: powershell -File set-role.ps1 -Role admin|user
const EXTENSION_ROLE = 'admin';

function isAdminBuild() {
  return EXTENSION_ROLE === 'admin';
}
