const enabledInput = document.getElementById('enabled');
const statusTitle = document.getElementById('status-title');
const statusDescription = document.getElementById('status-description');
const statusDot = document.getElementById('status-dot');
const openAppButton = document.getElementById('open-app');

chrome.storage.sync.get({ enabled: true }, (settings) => {
  enabledInput.checked = settings.enabled !== false;
  renderStatus(settings.enabled !== false);
});

enabledInput.addEventListener('change', () => {
  const enabled = enabledInput.checked;
  chrome.storage.sync.set({ enabled });
  renderStatus(enabled);
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
