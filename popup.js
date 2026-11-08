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
const updateAlert = document.getElementById('update-alert');
const updateAlertText = document.getElementById('update-alert-text');
const updateAlertOpen = document.getElementById('update-alert-open');
const updateAlertDismiss = document.getElementById('update-alert-dismiss');
const importAlert = document.getElementById('import-alert');
const importAlertEta = document.getElementById('import-alert-eta');
let highlightPreference = true;
let supabaseDbReady = false;
let importLocksHighlight = false;
let latestUpdateStatus = null;
let importAlertTimer = 0;
let currentSiteKey = '';
let siteToggleAllowed = false;
let enabledSites = [];
const IMPORT_BATCH_WORK_MS = 12_000;

function formatImportDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  }
  if (minutes > 0) {
    return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
  }
  return `${seconds} s`;
}

function estimateImportRemainingMs(progress) {
  if (!progress || progress.phase === 'done') {
    return 0;
  }
  const batchSize = Math.max(1, Number(progress.batchSize) || 500);
  const cooldownMs = Math.max(0, Number(progress.cooldownMs) || 5_000);
  const workMs = Math.max(IMPORT_BATCH_WORK_MS, Number(progress.lastBatchDurationMs) || 0);
  const perBatchMs = cooldownMs + workMs;
  const cardsLeft = Math.max(0, (Number(progress.totalCards) || 0) - (Number(progress.importedCards) || 0));
  const knownLeft = Math.max(0, (Number(progress.knownTotal) || 0) - (Number(progress.knownImported) || 0));
  const knownTotal = Number(progress.knownTotal) || 0;
  let batches = 0;
  if (progress.phase === 'cards') {
    batches = (cardsLeft > 0 ? Math.ceil(cardsLeft / batchSize) : 0)
      + (knownTotal > 0 ? Math.ceil(knownTotal / batchSize) : 0);
  } else if (progress.phase === 'known') {
    batches = knownLeft > 0 ? Math.ceil(knownLeft / batchSize) : 0;
  }
  if (progress.running && batches > 0) {
    batches -= 1;
  }
  const cooldownLeft = Math.max(0, (Number(progress.cooldownUntil) || 0) - Date.now());
  return Math.max(0, batches * perBatchMs + cooldownLeft);
}

function formatImportEtaText(progress) {
  if (!progress || progress.phase === 'done') {
    return '';
  }
  const ms = estimateImportRemainingMs(progress);
  return t('import.eta.remaining', { time: formatImportDuration(Math.max(ms, 1_000)) });
}

function renderImportAlert(progress) {
  importLocksHighlight = isImportLockingHighlight(progress);
  if (importAlert) {
    importAlert.hidden = !importLocksHighlight;
  }
  if (importAlertEta) {
    const etaText = importLocksHighlight ? formatImportEtaText(progress) : '';
    importAlertEta.hidden = !etaText;
    importAlertEta.textContent = etaText;
  }
  if (importAlertTimer) {
    window.clearInterval(importAlertTimer);
    importAlertTimer = 0;
  }
  if (importLocksHighlight && progress) {
    importAlertTimer = window.setInterval(() => {
      if (importAlertEta) {
        importAlertEta.textContent = formatImportEtaText(progress);
      }
    }, 1000);
  }
  renderHighlight();
}

function t(key, vars) {
  return window.LingqI18n ? LingqI18n.t(key, vars) : key;
}

function refreshPopupTexts() {
  if (window.LingqI18n) {
    LingqI18n.apply();
  }
  renderSiteStatus();
  renderHighlight();
  renderTheme(themeDarkInput.checked ? 'dark' : 'light', { skipApply: true });
  renderUpdateAlert(latestUpdateStatus);
  if (uiLocaleInput) {
    uiLocaleInput.value = LingqI18n.getLocale();
  }
}

function renderUpdateAlert(status) {
  latestUpdateStatus = status || null;
  if (!updateAlert) {
    return;
  }
  const available = Boolean(status?.updateAvailable && status.latestVersion);
  updateAlert.hidden = !available;
  if (!available) {
    return;
  }
  if (updateAlertText) {
    updateAlertText.textContent = t('update.text', {
      latest: status.latestVersion,
      current: status.currentVersion || '?',
    });
  }
  if (updateAlertOpen) {
    updateAlertOpen.href = status.releaseUrl || 'https://github.com/atrapSCA/LINGQ/releases';
  }
}

function refreshUpdateStatus({ forceCheck = false } = {}) {
  const type = forceCheck ? 'CHECK_FOR_UPDATE' : 'GET_UPDATE_STATUS';
  chrome.runtime.sendMessage({ type }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      return;
    }
    renderUpdateAlert(response);
  });
}

updateAlertDismiss?.addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'DISMISS_UPDATE',
    version: latestUpdateStatus?.latestVersion,
  }, (response) => {
    if (response?.ok) {
      renderUpdateAlert(response);
    } else if (updateAlert) {
      updateAlert.hidden = true;
    }
  });
});

LingqTheme.load((theme) => {
  renderTheme(theme);
});

LingqTheme.watch((theme) => {
  renderTheme(theme);
});

LingqI18n.load(() => {
  refreshPopupTexts();
  refreshUpdateStatus({ forceCheck: true });
});

LingqI18n.watch(() => {
  refreshPopupTexts();
});

function loadSiteToggleState() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0];
    currentSiteKey = LingqSites.siteKeyFromUrl(tab?.url || '');
    siteToggleAllowed = Boolean(currentSiteKey);
    chrome.storage.sync.get({ enabledSites: [], highlightEnabled: true }, (settings) => {
      enabledSites = Array.isArray(settings.enabledSites) ? settings.enabledSites : [];
      highlightPreference = settings.highlightEnabled !== false;
      renderSiteStatus();
      renderHighlight();
      refreshSupabaseDbStatus();
      refreshImportLockStatus();
    });
  });
}

loadSiteToggleState();

enabledInput.addEventListener('change', () => {
  if (!siteToggleAllowed || !currentSiteKey) {
    enabledInput.checked = false;
    renderSiteStatus();
    return;
  }
  const turnOn = enabledInput.checked;
  enabledSites = turnOn
    ? LingqSites.addEnabledSite(enabledSites, currentSiteKey)
    : LingqSites.removeEnabledSite(enabledSites, currentSiteKey);
  chrome.storage.sync.set({ enabledSites }, () => {
    renderSiteStatus();
  });
});

highlightEnabledInput.addEventListener('change', () => {
  if (!supabaseDbReady || importLocksHighlight) {
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

function refreshImportLockStatus() {
  chrome.storage.local.get('knownWordsSync', (stored) => {
    renderImportAlert(stored.knownWordsSync || null);
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.knownWordsSync) {
    renderImportAlert(changes.knownWordsSync.newValue || null);
  }
  if (areaName === 'sync' && changes.enabledSites) {
    enabledSites = Array.isArray(changes.enabledSites.newValue) ? changes.enabledSites.newValue : [];
    renderSiteStatus();
  }
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

function renderSiteStatus() {
  if (!siteToggleAllowed || !currentSiteKey) {
    enabledInput.disabled = true;
    enabledInput.checked = false;
    statusTitle.textContent = t('popup.status.unavailableTitle');
    statusDescription.textContent = t('popup.status.unavailableDesc');
    statusDot.classList.add('is-off');
    return;
  }
  const on = LingqSites.isHostEnabled(currentSiteKey, enabledSites);
  enabledInput.disabled = false;
  enabledInput.checked = on;
  statusTitle.textContent = on ? t('popup.status.onTitle') : t('popup.status.offTitle');
  statusDescription.textContent = on
    ? t('popup.status.onDesc', { site: currentSiteKey })
    : t('popup.status.offDesc', { site: currentSiteKey });
  statusDot.classList.toggle('is-off', !on);
}

function renderHighlight() {
  const available = supabaseDbReady && !importLocksHighlight;
  const on = available && highlightPreference;
  highlightEnabledInput.disabled = !available;
  highlightEnabledInput.checked = on;
  highlightCard?.classList.toggle('is-disabled', !supabaseDbReady);
  highlightCard?.classList.toggle('is-import-locked', importLocksHighlight);
  if (!supabaseDbReady) {
    highlightTitle.textContent = t('popup.highlight.needDbTitle');
    highlightDescription.textContent = t('popup.highlight.needDbDesc');
    highlightDot.classList.add('is-off');
    return;
  }
  if (importLocksHighlight) {
    highlightTitle.textContent = t('popup.highlight.importLockTitle');
    highlightDescription.textContent = t('popup.highlight.importLockDesc');
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
