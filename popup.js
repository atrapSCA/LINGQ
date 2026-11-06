const enabledInput = document.getElementById('enabled');
const statusTitle = document.getElementById('status-title');
const statusDescription = document.getElementById('status-description');
const statusDot = document.getElementById('status-dot');
const openAppButton = document.getElementById('open-app');
const themeDarkInput = document.getElementById('theme-dark');
const themeDescription = document.getElementById('theme-description');

LingqTheme.load((theme) => {
  renderTheme(theme);
});

LingqTheme.watch((theme) => {
  renderTheme(theme);
});

chrome.storage.sync.get({ enabled: true }, (settings) => {
  enabledInput.checked = settings.enabled !== false;
  renderStatus(settings.enabled !== false);
});

enabledInput.addEventListener('change', () => {
  const enabled = enabledInput.checked;
  chrome.storage.sync.set({ enabled });
  renderStatus(enabled);
});

themeDarkInput.addEventListener('change', () => {
  const theme = themeDarkInput.checked ? 'dark' : 'light';
  LingqTheme.save(theme, renderTheme);
});

openAppButton.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_APP' }, () => {
    window.close();
  });
});

function renderStatus(enabled) {
  statusTitle.textContent = enabled ? 'Doplněk je aktivní' : 'Doplněk je vypnutý';
  statusDescription.textContent = enabled
    ? 'Funguje na všech webových stránkách'
    : 'Překlady po kliknutí jsou pozastavené';
  statusDot.classList.toggle('is-off', !enabled);
}

function renderTheme(theme) {
  const next = LingqTheme.apply(theme);
  themeDarkInput.checked = next === 'dark';
  themeDescription.textContent = next === 'dark'
    ? 'Tmavý vzhled doplňku'
    : 'Světlý vzhled doplňku';
}
