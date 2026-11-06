// Role buildu doplňku.
// - 'admin'  = idle probe LingQ + překlad vět bez limitu délky
// - 'user'   = bez idle probe; překlad výběru max. 10 slov, delší text → odkaz na překladač
// Přepnutí: powershell -File set-role.ps1 -Role admin|user
const EXTENSION_ROLE = 'admin';

function isAdminBuild() {
  return EXTENSION_ROLE === 'admin';
}
