// Role buildu doplňku.
// - 'admin'  = idle probe LingQ; překlad vět bez limitu délky
// - 'user'   = bez idle probe; u LingQ max. 10 slov (ChatGPT bez limitu)
// Přepnutí: powershell -File set-role.ps1 -Role admin|user
const EXTENSION_ROLE = 'admin';

function isAdminBuild() {
  return EXTENSION_ROLE === 'admin';
}
