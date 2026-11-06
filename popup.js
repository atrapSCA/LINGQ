const enabledInput = document.getElementById('enabled');
const statusTitle = document.getElementById('status-title');
const statusDescription = document.getElementById('status-description');
const statusDot = document.getElementById('status-dot');
const openAppButton = document.getElementById('open-app');
const themeDarkInput = document.getElementById('theme-dark');
const themeDescription = document.getElementById('theme-description');
const uiLocaleInput = document.getElementById('ui-locale');

function t(key, vars) {
  return window.LingqI18n ? LingqI18n.t(key, vars) : key;
}

function refreshPopupTexts() {
  if (window.LingqI18n) {
    LingqI18n.apply();
  }
  renderStatus(enabledInput.checked);
  renderTheme(themeDarkInput.checked ? 'dark' : 'light', { skipApply: true });
  if (uiLocaleInput) {
    uiLocaleInput.value = LingqI18n.getLocale();
  }
}

LingqTheme.load((theme) => {
  renderTheme(theme);
});

LingqTheme.watch((theme) => {
  renderTheme(theme);
});

LingqI18n.load(() => {
  refreshPopupTexts();
});

LingqI18n.watch(() => {
  refreshPopupTexts();
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
  LingqTheme.save(theme, (next) => renderTheme(next));
});

uiLocaleInput.addEventListener('change', () => {
  LingqI18n.save(uiLocaleInput.value, () => {
    refreshPopupTexts();
  });
});

openAppButton.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_APP' }, () => {
    window.close();
  });
});

function renderStatus(enabled) {
  statusTitle.textContent = enabled ? t('popup.status.onTitle') : t('popup.status.offTitle');
  statusDescription.textContent = enabled ? t('popup.status.onDesc') : t('popup.status.offDesc');
  statusDot.classList.toggle('is-off', !enabled);
}

function renderTheme(theme, options = {}) {
  const next = LingqTheme.apply(theme);
  themeDarkInput.checked = next === 'dark';
  if (!options.skipApply && window.LingqI18n) {
    // keep static labels; only description changes with theme
  }
  themeDescription.textContent = next === 'dark' ? t('popup.themeDark') : t('popup.themeLight');
}
