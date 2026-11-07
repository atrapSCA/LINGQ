const DEFAULTS = {
  apiKey: '',
  language: 'en',
  targetLanguage: 'cs',
  enabled: true,
  clickCount: 1,
};

const form = document.getElementById('settings-form');
const apiKeyInput = document.getElementById('api-key');
const languageInput = document.getElementById('language');
const targetLanguageInput = document.getElementById('target-language');
const enabledInput = document.getElementById('enabled');
const clickCountInput = document.getElementById('click-count');
const clickHelp = document.getElementById('click-help');
const toggleKeyButton = document.getElementById('toggle-key');
const formMessage = document.getElementById('form-message');
const statusTitle = document.getElementById('status-title');
const statusDescription = document.getElementById('status-description');
const statusDot = document.getElementById('status-dot');

chrome.storage.sync.get(DEFAULTS, (settings) => {
  apiKeyInput.value = settings.apiKey;
  languageInput.value = settings.language;
  targetLanguageInput.value = settings.targetLanguage;
  enabledInput.checked = settings.enabled;
  clickCountInput.value = Number(settings.clickCount) === 2 ? '2' : '1';
  renderStatus(settings.enabled);
  renderClickHelp(clickCountInput.value);
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  chrome.storage.sync.set({
    apiKey: apiKeyInput.value.trim(),
    language: languageInput.value,
    targetLanguage: targetLanguageInput.value,
  }, () => {
    formMessage.textContent = 'Nastavení bylo uloženo.';
    window.setTimeout(() => { formMessage.textContent = ''; }, 2200);
  });
});

enabledInput.addEventListener('change', () => {
  const enabled = enabledInput.checked;
  chrome.storage.sync.set({ enabled });
  renderStatus(enabled);
});

clickCountInput.addEventListener('change', () => {
  const clickCount = clickCountInput.value === '2' ? 2 : 1;
  chrome.storage.sync.set({ clickCount });
  renderClickHelp(clickCount);
});

toggleKeyButton.addEventListener('click', () => {
  const showing = apiKeyInput.type === 'text';
  apiKeyInput.type = showing ? 'password' : 'text';
  toggleKeyButton.textContent = showing ? 'Zobrazit' : 'Skrýt';
});

function renderClickHelp(clickCount) {
  clickHelp.textContent = Number(clickCount) === 2
    ? 'Bublina se otevře po dvojitém kliknutí na slovo.'
    : 'Bublina se otevře po jednom kliknutí. U odkazů je potřeba dvojité kliknutí, aby se stránka neotevřela.';
}

function renderStatus(enabled) {
  statusTitle.textContent = enabled ? 'Doplněk je aktivní' : 'Doplněk je pozastavený';
  statusDescription.textContent = enabled ? 'Funguje na všech webových stránkách' : 'Kliknutí na slova jsou dočasně vypnutá';
  statusDot.style.background = enabled ? '#4dbea0' : '#a9b7b5';
  statusDot.style.boxShadow = enabled ? '0 0 0 4px #e2f4ef' : '0 0 0 4px #edf1f0';
}
