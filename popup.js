const enabledInput = document.getElementById('enabled');
const statusTitle = document.getElementById('status-title');
const statusDescription = document.getElementById('status-description');
const statusDot = document.getElementById('status-dot');
const highlightEnabledInput = document.getElementById('highlight-enabled');
const highlightCard = document.querySelector('.highlight-card');
const highlightTitle = document.getElementById('highlight-title');
const highlightDescription = document.getElementById('highlight-description');
const highlightDot = document.getElementById('highlight-dot');
const openAppButton = document.getElementById('open-app');
const themeDarkInput = document.getElementById('theme-dark');
const themeDescription = document.getElementById('theme-description');
const uiLocaleInput = document.getElementById('ui-locale');
let highlightPreference = true;
let supabaseDbReady = false;

function t(key, vars) {
  return window.LingqI18n ? LingqI18n.t(key, vars) : key;
}

function refreshPopupTexts() {
  if (window.LingqI18n) {
    LingqI18n.apply();
  }
  renderStatus(enabledInput.checked);
  renderHighlight();
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

chrome.storage.sync.get({ enabled: true, highlightEnabled: true }, (settings) => {
  enabledInput.checked = settings.enabled !== false;
  renderStatus(settings.enabled !== false);
  highlightPreference = settings.highlightEnabled !== false;
  highlightEnabledInput.checked = highlightPreference;
  refreshSupabaseDbStatus();
});

enabledInput.addEventListener('change', () => {
  const enabled = enabledInput.checked;
  chrome.storage.sync.set({ enabled });
  renderStatus(enabled);
});

highlightEnabledInput.addEventListener('change', () => {
  if (!supabaseDbReady) {
    highlightEnabledInput.checked = false;
    renderHighlight();
    return;
  }
  highlightPreference = highlightEnabledInput.checked;
  chrome.storage.sync.set({ highlightEnabled: highlightPreference });
  renderHighlight();
});

function refreshSupabaseDbStatus() {
  chrome.runtime.sendMessage({ type: 'GET_SUPABASE_STATUS', force: false }, (response) => {
    supabaseDbReady = Boolean(response?.ok && response.ready === true);
    renderHighlight();
  });
}

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

function renderHighlight() {
  const available = supabaseDbReady;
  const on = available && highlightPreference;
  highlightEnabledInput.disabled = !available;
  highlightEnabledInput.checked = on;
  highlightCard?.classList.toggle('is-disabled', !available);
  if (!available) {
    highlightTitle.textContent = t('popup.highlight.needDbTitle');
    highlightDescription.textContent = t('popup.highlight.needDbDesc');
    highlightDot.classList.add('is-off');
    return;
  }
  highlightTitle.textContent = on ? t('popup.highlight.onTitle') : t('popup.highlight.offTitle');
  highlightDescription.textContent = on ? t('popup.highlight.onDesc') : t('popup.highlight.offDesc');
  highlightDot.classList.toggle('is-off', !on);
}

function renderTheme(theme, options = {}) {
  const next = LingqTheme.apply(theme);
  themeDarkInput.checked = next === 'dark';
  if (!options.skipApply && window.LingqI18n) {
    // keep static labels; only description changes with theme
  }
  themeDescription.textContent = next === 'dark' ? t('popup.themeDark') : t('popup.themeLight');
}
