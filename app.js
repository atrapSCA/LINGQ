const form = document.getElementById('settings-form');
const lingqEnabledInput = document.getElementById('lingq-enabled');
const lingqSettingsBlock = document.getElementById('lingq-settings-block');
const lingqEnabledHelp = document.getElementById('lingq-enabled-help');
const lingqBlockAlert = document.getElementById('lingq-block-alert');
const lingqSyncStatus = document.getElementById('lingq-sync-status');
const apiKeyInput = document.getElementById('api-key');
const chatgptEnabledInput = document.getElementById('chatgpt-enabled');
const chatgptSettingsBlock = document.getElementById('chatgpt-settings-block');
const chatgptKeyBlock = document.getElementById('chatgpt-key-block');
const chatgptApiKeyInput = document.getElementById('chatgpt-api-key');
const chatgptKeyStatus = document.getElementById('chatgpt-key-status');
const translationSourceBlock = document.getElementById('translation-source-block');
let allowTranslationSourceFlash = false;
const newWordSourceInput = document.getElementById('new-word-source');
const newWordSourceChatgptOption = document.getElementById('new-word-source-chatgpt');
const newWordSourceHelp = document.getElementById('new-word-source-help');
const alternativesSourceInput = document.getElementById('alternatives-source');
const alternativesSourceChatgptOption = document.getElementById('alternatives-source-chatgpt');
const alternativesSourceHelp = document.getElementById('alternatives-source-help');
const phraseSourceInput = document.getElementById('phrase-source');
const phraseSourceChatgptOption = document.getElementById('phrase-source-chatgpt');
const phraseSourceHelp = document.getElementById('phrase-source-help');
const chatgptModelInput = document.getElementById('chatgpt-model');
const chatgptModelHelp = document.getElementById('chatgpt-model-help');
const languageInput = document.getElementById('language');
const targetLanguageInput = document.getElementById('target-language');
const supabaseEnabledInput = document.getElementById('supabase-enabled');
const supabaseSettingsBlock = document.getElementById('supabase-settings-block');
const supabaseUrlInput = document.getElementById('supabase-url');
const supabaseKeyInput = document.getElementById('supabase-key');
const clickCountInput = document.getElementById('click-count');
const highlightEnabledInput = document.getElementById('highlight-enabled');
const enabledSitesList = document.getElementById('enabled-sites-list');
const enabledSitesEmpty = document.getElementById('enabled-sites-empty');
let enabledSites = [];
const importAlert = document.getElementById('import-alert');
let importLocksHighlight = false;
const latencyIdleMinInput = document.getElementById('latency-idle-min');
const latencyIdleMaxInput = document.getElementById('latency-idle-max');
const adminIdleSettings = document.getElementById('admin-idle-settings');
const clickHelp = document.getElementById('click-help');
const toggleKeyButton = document.getElementById('toggle-key');
const toggleChatgptKeyButton = document.getElementById('toggle-chatgpt-key');
const toggleSupabaseKeyButton = document.getElementById('toggle-supabase-key');
const checkSupabaseDbButton = document.getElementById('check-supabase-db');
const installSupabaseDbButton = document.getElementById('install-supabase-db');
const supabaseDbStatus = document.getElementById('supabase-db-status');
const formMessage = document.getElementById('form-message');
let chatgptApiKeyValid = false;
let chatgptValidationRequest = 0;
const tabButtons = [...document.querySelectorAll('.tab')];
const panelSettings = document.getElementById('panel-settings');
const panelWords = document.getElementById('panel-words');
const panelImport = document.getElementById('panel-import');
const panelStats = document.getElementById('panel-stats');
const panelLatency = document.getElementById('panel-latency');
const panelAuthor = document.getElementById('panel-author');
const wordSearchInput = document.getElementById('word-search');
const wordStatusFilterInput = document.getElementById('word-status-filter');
const wordSortInput = document.getElementById('word-sort');
const wordsMeta = document.getElementById('words-meta');
const wordsList = document.getElementById('words-list');
const wordsLetters = document.getElementById('words-letters');
const WORD_LETTER_KEYS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];
const WORDS_TOP_RENDER_CAP = 200;
const WORDS_SEARCH_LIMIT = 200;
let wordLetterFilter = null;
let wordsBucket = [];
let wordsCache = new Map();
let wordsLetterCounts = Object.create(null);
let wordsEmptyLetters = new Set();
let wordsTotalInDb = null;
let wordsIndexReady = false;
let wordsLoadToken = 0;
let wordSearchTimer = null;
const syncKnownWordsButton = document.getElementById('sync-known-words');
const resetLingqImportButton = document.getElementById('reset-lingq-import');
const importKnownStatus = document.getElementById('import-known-status');
const importProgress = document.getElementById('import-progress');
const importProgressPhase = document.getElementById('import-progress-phase');
const importProgressNumbers = document.getElementById('import-progress-numbers');
const importProgressFill = document.getElementById('import-progress-fill');
const importProgressBar = document.getElementById('import-progress-bar');
const importProgressTotalLabel = document.getElementById('import-progress-total-label');
const importProgressEta = document.getElementById('import-progress-eta');
const importAlertEta = document.getElementById('import-alert-eta');
/** Odhad práce na dávku (stažení + upload) nad rámec pauzy. */
const IMPORT_BATCH_WORK_MS = 12_000;
const importCardsNumbers = document.getElementById('import-cards-numbers');
const importKnownNumbers = document.getElementById('import-known-numbers');
let importCooldownTimer = null;
const statsMeta = document.getElementById('stats-meta');
const statsHeatmap = document.getElementById('stats-heatmap');
const statsYearTitle = document.getElementById('stats-year-title');
const statsYearPrevButton = document.getElementById('stats-year-prev');
const statsYearNextButton = document.getElementById('stats-year-next');
let statsYear = new Date().getFullYear();
const latencyMeta = document.getElementById('latency-meta');
const latencyChart = document.getElementById('latency-chart');
const statsTableBody = document.querySelector('#stats-table tbody');
const latencyTableBody = document.querySelector('#latency-table tbody');
function weekdayLabels() {
  return [0, 1, 2, 3, 4, 5, 6].map((index) => t(`weekday.${index}`));
}

function uiDateLocale() {
  const code = window.LingqI18n ? LingqI18n.getLocale() : 'en';
  return ({ cs: 'cs-CZ', en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES' }[code]) || 'en-US';
}

let wordsLoaded = false;
let wordsLoading = false;
let statsLoading = false;
let latencyLoading = false;
let latencyLoaded = false;
let supabaseReady = false;
let supabaseGateMessage = '';
let supabaseSchemaNeedsUpdate = false;
const schemaAlert = document.getElementById('schema-alert');
const schemaAlertText = document.getElementById('schema-alert-text');
const schemaAlertOpenSettings = document.getElementById('schema-alert-open-settings');
const dbModeAlert = document.getElementById('db-mode-alert');
const updateAlert = document.getElementById('update-alert');
const updateAlertText = document.getElementById('update-alert-text');
const updateAlertOpen = document.getElementById('update-alert-open');
const updateAlertDismiss = document.getElementById('update-alert-dismiss');
let latestUpdateStatus = null;

function t(key, vars) {
  return window.LingqI18n ? LingqI18n.t(key, vars) : key;
}

function applyUiLocale() {
  if (!window.LingqI18n) {
    return;
  }
  LingqI18n.apply();
  // Číselné úrovně znalosti 1–4
  [1, 2, 3, 4].forEach((level) => {
    const option = wordStatusFilterInput?.querySelector(`option[value="${level}"]`);
    if (option) {
      option.textContent = t('words.statusN', { n: level });
    }
  });
  renderClickHelp(clickCountInput.value);
  applyChatgptModelLabels();
  updateLingqAvailability();
  updateChatgptDependentAvailability({
    alternativesSource: alternativesSourceInput?.value,
    newWordTranslationSource: newWordSourceInput?.value,
    phraseTranslationSource: phraseSourceInput?.value,
  });
  refreshSupabaseGate({ force: false });
  renderUpdateAlert(latestUpdateStatus);
  renderEnabledSites();
  // Obnovit kalendář / tabulky s novým jazykem, pokud už jsou načtené.
  if (statsHeatmap?.dataset.loaded) {
    loadStats(true);
  }
  if (latencyLoaded) {
    loadLatency(true);
  }
}

if (window.LingqTheme) {
  LingqTheme.load();
  LingqTheme.watch();
}

if (window.LingqI18n) {
  LingqI18n.load(() => {
    applyUiLocale();
    refreshUpdateStatus({ forceCheck: true });
  });
  LingqI18n.watch(() => {
    applyUiLocale();
  });
}

chrome.runtime.sendMessage({ type: 'APP_OPENED' }, () => {
  void chrome.runtime.lastError;
});

applyBuildRoleUi();
refreshUpdateStatus({ forceCheck: false });
refreshSupabaseGate({ force: true }).finally(() => {
  restoreKnownWordsSyncStatus();
  // První otevření často stihne Slovník dřív, než doběhne kontrola DB — po gate znovu načti aktivní záložku.
  if (!panelWords.hidden) {
    loadWords(true);
  } else if (!panelStats.hidden) {
    loadStats(true);
  } else if (!panelLatency.hidden) {
    loadLatency(true);
  } else if (!panelImport.hidden) {
    restoreKnownWordsSyncStatus();
  }
});

function applyBuildRoleUi() {
  const admin = typeof isAdminBuild === 'function' && isAdminBuild();
  if (adminIdleSettings) {
    adminIdleSettings.hidden = !admin;
  }
  document.body.classList.toggle('is-admin-build', admin);
  document.body.classList.toggle('is-user-build', !admin);
}

function renderImportHighlightAlert(progress) {
  importLocksHighlight = isImportLockingHighlight(progress);
  if (importAlert) {
    importAlert.hidden = !importLocksHighlight;
  }
  if (importAlertEta) {
    const etaText = importLocksHighlight ? formatImportEtaText(progress) : '';
    importAlertEta.hidden = !etaText;
    importAlertEta.textContent = etaText;
  }
  if (highlightEnabledInput) {
    highlightEnabledInput.disabled = importLocksHighlight || highlightEnabledInput.disabled;
    if (importLocksHighlight) {
      highlightEnabledInput.checked = false;
    }
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.knownWordsSync) {
    const progress = changes.knownWordsSync.newValue || null;
    renderKnownWordsSyncProgress(progress);
    renderImportHighlightAlert(progress);
  }
  if (areaName === 'sync' && changes.enabledSites) {
    enabledSites = Array.isArray(changes.enabledSites.newValue) ? changes.enabledSites.newValue : [];
    renderEnabledSites();
  }
});

function normalizeEnabledSites(list) {
  if (typeof LingqSites !== 'undefined') {
    return (Array.isArray(list) ? list : [])
      .map((site) => LingqSites.normalizeSiteHost(site))
      .filter(Boolean)
      .sort();
  }
  return Array.isArray(list) ? [...list].filter(Boolean).sort() : [];
}

function renderEnabledSites() {
  if (!enabledSitesList || !enabledSitesEmpty) {
    return;
  }
  const sites = normalizeEnabledSites(enabledSites);
  enabledSitesList.replaceChildren();
  enabledSitesEmpty.hidden = sites.length > 0;
  sites.forEach((site) => {
    const item = document.createElement('li');
    item.className = 'enabled-sites-list__item';
    const host = document.createElement('span');
    host.className = 'enabled-sites-list__host';
    host.textContent = site;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'enabled-sites-list__remove';
    remove.textContent = t('settings.enabledSitesRemove');
    remove.addEventListener('click', () => {
      enabledSites = typeof LingqSites !== 'undefined'
        ? LingqSites.removeEnabledSite(enabledSites, site)
        : enabledSites.filter((entry) => entry !== site);
      chrome.storage.sync.set({ enabledSites }, () => {
        renderEnabledSites();
      });
    });
    item.append(host, remove);
    enabledSitesList.append(item);
  });
}

syncKnownWordsButton.addEventListener('click', () => {
  startKnownWordsSync();
});

resetLingqImportButton.addEventListener('click', () => {
  if (!window.confirm(t('import.confirmReset'))) {
    return;
  }
  chrome.runtime.sendMessage({ type: 'RESET_LINGQ_IMPORT_PROGRESS' }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      setKnownWordsStatus(
        response?.error || chrome.runtime.lastError?.message || t('import.err.resetFailed'),
        'error',
      );
      return;
    }
    renderKnownWordsSyncProgress(response.progress);
  });
});

getExtensionSettings().then((settings) => {
  apiKeyInput.value = settings.apiKey;
  lingqEnabledInput.checked = settings.lingqEnabled !== false;
  chatgptEnabledInput.checked = settings.chatgptEnabled !== false;
  chatgptApiKeyInput.value = settings.chatgptApiKey || '';
  chatgptApiKeyValid = settings.chatgptApiKeyValid === true && Boolean(String(settings.chatgptApiKey || '').trim());
  chatgptModelInput.value = resolveChatgptModel(settings.chatgptModel);
  languageInput.value = settings.language;
  targetLanguageInput.value = settings.targetLanguage;
  supabaseEnabledInput.checked = settings.supabaseEnabled !== false;
  supabaseUrlInput.value = settings.supabaseUrl || DEFAULTS.supabaseUrl;
  supabaseKeyInput.value = settings.supabaseKey || DEFAULTS.supabaseKey;
  clickCountInput.value = Number(settings.clickCount) === 2 ? '2' : '1';
  if (highlightEnabledInput) {
    highlightEnabledInput.checked = settings.highlightEnabled !== false;
  }
  enabledSites = normalizeEnabledSites(settings.enabledSites);
  renderEnabledSites();
  const idleRange = normalizeIdleRange(settings);
  latencyIdleMinInput.value = String(idleRange.min);
  latencyIdleMaxInput.value = String(idleRange.max);
  renderClickHelp(clickCountInput.value);
  applyOptionalFeatureUi();
  updateLingqAvailability();
  updateChatgptDependentAvailability({
    alternativesSource: settings.alternativesSource === 'chatgpt' ? 'chatgpt' : 'lingq',
    newWordTranslationSource: settings.newWordTranslationSource === 'chatgpt' ? 'chatgpt' : 'lingq',
    phraseTranslationSource: settings.phraseTranslationSource === 'chatgpt' ? 'chatgpt' : 'lingq',
  });
  if (chatgptEnabledInput.checked && chatgptApiKeyInput.value.trim()) {
    validateChatgptApiKey(chatgptApiKeyInput.value.trim(), { quiet: chatgptApiKeyValid });
  } else {
    setChatgptKeyStatus('');
  }
  pollLingqSyncStatus();
  allowTranslationSourceFlash = true;
  activateTab('words');
});

tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    activateTab(button.dataset.tab);
  });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const chatgptEnabled = chatgptEnabledInput.checked;
  const supabaseEnabled = supabaseEnabledInput.checked;
  let lingqEnabled = lingqEnabledInput.checked;
  const chatgptApiKey = chatgptEnabled ? chatgptApiKeyInput.value.trim() : chatgptApiKeyInput.value.trim();
  const valid = chatgptEnabled ? await validateChatgptApiKey(chatgptApiKey) : false;
  if (!lingqEnabled && !(supabaseEnabled && supabaseReady && chatgptEnabled && valid)) {
    lingqEnabled = true;
    lingqEnabledInput.checked = true;
    formMessage.textContent = t('settings.cannotDisableLingq');
  }
  const offlineOnly = !lingqEnabled;
  const alternativesSource = offlineOnly || (chatgptEnabled && valid && alternativesSourceInput.value === 'chatgpt')
    ? 'chatgpt'
    : 'lingq';
  const newWordTranslationSource = offlineOnly || (chatgptEnabled && valid && newWordSourceInput.value === 'chatgpt')
    ? 'chatgpt'
    : 'lingq';
  const phraseTranslationSource = offlineOnly || (chatgptEnabled && valid && phraseSourceInput.value === 'chatgpt')
    ? 'chatgpt'
    : 'lingq';
  applyOptionalFeatureUi();
  updateLingqAvailability();
  updateChatgptDependentAvailability({ alternativesSource, newWordTranslationSource, phraseTranslationSource });
  const prefs = {
    lingqEnabled,
    chatgptEnabled,
    chatgptModel: resolveChatgptModel(chatgptModelInput.value),
    alternativesSource,
    newWordTranslationSource,
    phraseTranslationSource,
    language: languageInput.value,
    targetLanguage: targetLanguageInput.value,
    highlightEnabled: highlightEnabledInput ? highlightEnabledInput.checked : true,
    supabaseEnabled,
    supabaseUrl: supabaseUrlInput.value.trim().replace(/\/$/, ''),
    ...readIdleRange(),
  };
  const secrets = {
    apiKey: apiKeyInput.value.trim(),
    chatgptApiKey,
    chatgptApiKeyValid: valid,
    supabaseKey: supabaseKeyInput.value.trim(),
  };
  Promise.all([
    setExtensionPrefs(prefs),
    setExtensionSecrets(secrets),
  ]).then(() => {
    const idleRange = readIdleRange();
    latencyIdleMinInput.value = String(idleRange.latencyIdleMinSeconds);
    latencyIdleMaxInput.value = String(idleRange.latencyIdleMaxSeconds);
    formMessage.textContent = t('settings.saved');
    resetWordsCache();
    latencyLoaded = false;
    refreshSupabaseGate({ force: true });
    window.setTimeout(() => { formMessage.textContent = ''; }, 2200);
  });
});

chatgptEnabledInput.addEventListener('change', () => {
  const settingsScrollTop = getSettingsScrollBody()?.scrollTop;
  const chatgptEnabled = chatgptEnabledInput.checked;
  applyOptionalFeatureUi();
  afterSettingsLayout(settingsScrollTop);
  if (!chatgptEnabled) {
    chatgptApiKeyValid = false;
    if (!lingqEnabledInput.checked) {
      lingqEnabledInput.checked = true;
      chrome.storage.sync.set({ lingqEnabled: true });
    }
    updateLingqAvailability();
    updateChatgptDependentAvailability({
      alternativesSource: 'lingq',
      newWordTranslationSource: 'lingq',
      phraseTranslationSource: 'lingq',
    });
    chrome.storage.sync.set({
      chatgptEnabled: false,
      alternativesSource: 'lingq',
      newWordTranslationSource: 'lingq',
      phraseTranslationSource: 'lingq',
    });
    return;
  }
  chrome.storage.sync.set({ chatgptEnabled: true });
  updateLingqAvailability();
  if (chatgptApiKeyInput.value.trim()) {
    validateChatgptApiKey(chatgptApiKeyInput.value.trim());
  } else {
    updateChatgptDependentAvailability({
      alternativesSource: 'lingq',
      newWordTranslationSource: 'lingq',
      phraseTranslationSource: 'lingq',
    });
  }
});

function getSettingsScrollBody() {
  return document.querySelector('.settings-form__body');
}

function keepPanelChromeVisible(settingsScrollTop) {
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  const panel = document.querySelector('.panel');
  if (panel) {
    panel.scrollTop = 0;
  }
  const content = document.querySelector('.panel__content');
  if (content) {
    content.scrollTop = 0;
  }
  const settingsBody = getSettingsScrollBody();
  if (settingsBody && Number.isFinite(settingsScrollTop)) {
    settingsBody.scrollTop = settingsScrollTop;
  }
}

function afterSettingsLayout(settingsScrollTop) {
  keepPanelChromeVisible(settingsScrollTop);
  requestAnimationFrame(() => {
    keepPanelChromeVisible(settingsScrollTop);
    requestAnimationFrame(() => keepPanelChromeVisible(settingsScrollTop));
  });
}

supabaseEnabledInput.addEventListener('change', () => {
  const settingsBody = getSettingsScrollBody();
  const settingsScrollTop = settingsBody ? settingsBody.scrollTop : 0;
  const supabaseEnabled = supabaseEnabledInput.checked;
  applyOptionalFeatureUi();
  afterSettingsLayout(settingsScrollTop);
  if (!supabaseEnabled && !lingqEnabledInput.checked) {
    lingqEnabledInput.checked = true;
    chrome.storage.sync.set({ lingqEnabled: true });
  }
  chrome.storage.sync.set({ supabaseEnabled }, () => {
    resetWordsCache();
    latencyLoaded = false;
    refreshSupabaseGate({ force: true }).finally(() => {
      updateLingqAvailability();
      afterSettingsLayout(settingsScrollTop);
      // Focus scrollIntoView umí odscrollovat shell — vrať focus bez scrollu.
      try {
        supabaseEnabledInput.focus({ preventScroll: true });
      } catch {
        supabaseEnabledInput.focus();
      }
      afterSettingsLayout(settingsScrollTop);
    });
  });
});

lingqEnabledInput.addEventListener('change', () => {
  const wantOff = !lingqEnabledInput.checked;
  if (wantOff && !canDisableLingq()) {
    lingqEnabledInput.checked = true;
    showLingqDisableBlockedAlert();
    return;
  }
  hideLingqDisableBlockedAlert();
  applyOptionalFeatureUi();
  updateLingqAvailability();
  if (wantOff) {
    chrome.storage.sync.set({
      lingqEnabled: false,
      alternativesSource: 'chatgpt',
      newWordTranslationSource: 'chatgpt',
      phraseTranslationSource: 'chatgpt',
    });
    updateChatgptDependentAvailability({
      alternativesSource: 'chatgpt',
      newWordTranslationSource: 'chatgpt',
      phraseTranslationSource: 'chatgpt',
    });
    return;
  }
  chrome.storage.sync.set({ lingqEnabled: true }, () => {
    if (lingqSyncStatus) {
      lingqSyncStatus.textContent = t('settings.syncStarting');
    }
    chrome.runtime.sendMessage({ type: 'SYNC_DB_TO_LINGQ' }, () => {
      pollLingqSyncStatus(true);
    });
  });
});

statsYearPrevButton?.addEventListener('click', () => {
  statsYear -= 1;
  updateStatsYearControls();
  loadStats(true);
});

statsYearNextButton?.addEventListener('click', () => {
  const maxYear = new Date().getFullYear();
  if (statsYear >= maxYear) {
    return;
  }
  statsYear += 1;
  updateStatsYearControls();
  loadStats(true);
});

updateStatsYearControls();

clickCountInput.addEventListener('change', () => {
  const clickCount = clickCountInput.value === '2' ? 2 : 1;
  chrome.storage.sync.set({ clickCount });
  renderClickHelp(clickCount);
});

highlightEnabledInput?.addEventListener('change', () => {
  if (highlightEnabledInput.disabled || !supabaseReady || importLocksHighlight) {
    highlightEnabledInput.checked = false;
    return;
  }
  chrome.storage.sync.set({ highlightEnabled: highlightEnabledInput.checked });
});

function saveIdleRange() {
  const idleRange = readIdleRange();
  latencyIdleMinInput.value = String(idleRange.latencyIdleMinSeconds);
  latencyIdleMaxInput.value = String(idleRange.latencyIdleMaxSeconds);
  chrome.storage.sync.set(idleRange);
}

latencyIdleMinInput.addEventListener('change', saveIdleRange);
latencyIdleMaxInput.addEventListener('change', saveIdleRange);

newWordSourceInput.addEventListener('change', () => {
  if (!chatgptApiKeyValid && newWordSourceInput.value === 'chatgpt') {
    updateChatgptDependentAvailability({ newWordTranslationSource: 'lingq' });
    return;
  }
  chrome.storage.sync.set({
    newWordTranslationSource: newWordSourceInput.value === 'chatgpt' ? 'chatgpt' : 'lingq',
  });
});

alternativesSourceInput.addEventListener('change', () => {
  if (!chatgptApiKeyValid && alternativesSourceInput.value === 'chatgpt') {
    updateChatgptDependentAvailability({ alternativesSource: 'lingq' });
    return;
  }
  chrome.storage.sync.set({
    alternativesSource: alternativesSourceInput.value === 'chatgpt' ? 'chatgpt' : 'lingq',
  });
});

phraseSourceInput.addEventListener('change', () => {
  if (!chatgptApiKeyValid && phraseSourceInput.value === 'chatgpt') {
    updateChatgptDependentAvailability({ phraseTranslationSource: 'lingq' });
    return;
  }
  const phraseTranslationSource = phraseSourceInput.value === 'chatgpt' ? 'chatgpt' : 'lingq';
  updatePhraseSourceHelp(phraseTranslationSource);
  chrome.storage.sync.set({ phraseTranslationSource });
});

chatgptModelInput.addEventListener('change', () => {
  if (!chatgptApiKeyValid) {
    updateChatgptDependentAvailability({
      alternativesSource: 'lingq',
      newWordTranslationSource: 'lingq',
      phraseTranslationSource: 'lingq',
    });
    return;
  }
  const chatgptModel = resolveChatgptModel(chatgptModelInput.value);
  chatgptModelInput.value = chatgptModel;
  chrome.storage.sync.set({ chatgptModel });
});

chatgptApiKeyInput.addEventListener('change', () => {
  validateChatgptApiKey(chatgptApiKeyInput.value.trim()).then((valid) => {
    chatgptApiKeyValid = valid;
    const alternativesSource = valid && alternativesSourceInput.value === 'chatgpt' ? 'chatgpt' : 'lingq';
    const newWordTranslationSource = valid && newWordSourceInput.value === 'chatgpt' ? 'chatgpt' : 'lingq';
    const phraseTranslationSource = valid && phraseSourceInput.value === 'chatgpt' ? 'chatgpt' : 'lingq';
    Promise.all([
      setExtensionSecrets({
        chatgptApiKey: chatgptApiKeyInput.value.trim(),
        chatgptApiKeyValid: valid,
      }),
      setExtensionPrefs({
        chatgptModel: resolveChatgptModel(chatgptModelInput.value),
        alternativesSource,
        newWordTranslationSource,
        phraseTranslationSource,
      }),
    ]);
  });
});

function setChatgptKeyStatus(message, tone = '') {
  chatgptKeyStatus.textContent = message;
  chatgptKeyStatus.dataset.tone = tone;
}

function applyOptionalFeatureUi() {
  const chatgptOn = chatgptEnabledInput.checked;
  const supabaseOn = supabaseEnabledInput.checked;
  const lingqOn = lingqEnabledInput.checked;
  if (chatgptSettingsBlock) {
    chatgptSettingsBlock.hidden = !chatgptOn;
  }
  if (chatgptKeyBlock) {
    chatgptKeyBlock.hidden = !chatgptOn;
  }
  if (supabaseSettingsBlock) {
    supabaseSettingsBlock.hidden = !supabaseOn;
  }
  if (lingqSettingsBlock) {
    lingqSettingsBlock.hidden = !lingqOn;
  }
  if (adminIdleSettings) {
    // admin idle zůstává řízené applyBuildRoleUi; sem jen respekt k LingQ
  }
}

function canDisableLingq() {
  return Boolean(
    supabaseEnabledInput.checked
    && supabaseReady
    && chatgptEnabledInput.checked
    && chatgptApiKeyValid
    && chatgptApiKeyInput.value.trim(),
  );
}

function getLingqDisableBlockReasons() {
  const reasons = [];
  if (!supabaseEnabledInput.checked) {
    reasons.push(t('settings.needSupabaseOn'));
  } else if (!supabaseReady) {
    reasons.push(t('settings.needSupabaseReady'));
  }
  if (!chatgptEnabledInput.checked) {
    reasons.push(t('settings.needChatgptOn'));
  } else if (!chatgptApiKeyInput.value.trim()) {
    reasons.push(t('settings.needChatgptKey'));
  } else if (!chatgptApiKeyValid) {
    reasons.push(t('settings.needChatgptValid'));
  }
  return reasons;
}

function showLingqDisableBlockedAlert() {
  if (!lingqBlockAlert) {
    return;
  }
  const reasons = getLingqDisableBlockReasons();
  lingqBlockAlert.hidden = false;
  lingqBlockAlert.textContent = reasons.length
    ? t('settings.lingqBlock', { reasons: reasons.join('; ') })
    : t('settings.lingqBlockPlain');
}

function hideLingqDisableBlockedAlert() {
  if (!lingqBlockAlert) {
    return;
  }
  lingqBlockAlert.hidden = true;
  lingqBlockAlert.textContent = '';
}

function updateLingqAvailability() {
  const canOff = canDisableLingq();
  if (canOff) {
    hideLingqDisableBlockedAlert();
  }
  if (lingqEnabledHelp) {
    lingqEnabledHelp.textContent = canOff || !lingqEnabledInput.checked
      ? t('settings.lingqHelp')
      : t('settings.lingqHelpNeedDeps');
  }
  if (!lingqEnabledInput.checked) {
    newWordSourceInput.value = 'chatgpt';
    alternativesSourceInput.value = 'chatgpt';
  }
}

function pollLingqSyncStatus(force = false) {
  if (!lingqSyncStatus) {
    return;
  }
  chrome.runtime.sendMessage({ type: 'GET_LINGQ_SYNC_STATUS' }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      return;
    }
    const sync = response.sync || {};
    if (sync.message) {
      lingqSyncStatus.textContent = sync.message;
    } else if (force) {
      lingqSyncStatus.textContent = '';
    }
    if (sync.running) {
      window.setTimeout(() => pollLingqSyncStatus(true), 800);
    }
  });
}

function flashTranslationSourceAttention() {
  if (!translationSourceBlock || translationSourceBlock.hidden) {
    return;
  }
  translationSourceBlock.classList.remove('is-attention');
  // Restart CSS transition after paint.
  void translationSourceBlock.offsetWidth;
  translationSourceBlock.classList.add('is-attention');
  window.clearTimeout(flashTranslationSourceAttention.timer);
  flashTranslationSourceAttention.timer = window.setTimeout(() => {
    translationSourceBlock.classList.remove('is-attention');
  }, 4200);
}

function updateChatgptDependentAvailability(preferences = {}) {
  const chatgptOn = chatgptEnabledInput.checked;
  const lingqOn = lingqEnabledInput.checked;
  const available = chatgptOn && chatgptApiKeyValid === true;
  const preferredAlternatives = preferences.alternativesSource ?? alternativesSourceInput.value;
  const preferredNewWord = preferences.newWordTranslationSource ?? newWordSourceInput.value;
  const preferredPhrase = preferences.phraseTranslationSource ?? phraseSourceInput.value;
  const wasHidden = Boolean(translationSourceBlock?.hidden);

  if (translationSourceBlock) {
    translationSourceBlock.hidden = !available;
  }
  if (available && wasHidden && allowTranslationSourceFlash) {
    flashTranslationSourceAttention();
  }

  chatgptModelInput.disabled = !available;
  chatgptModelInput.value = resolveChatgptModel(chatgptModelInput.value);

  if (!available) {
    // Bez zapnutého ChatGPT / platného klíče volby skryté — používá se LingQ (nebo ChatGPT, když je LingQ vypnuté).
    newWordSourceInput.value = lingqOn ? 'lingq' : 'chatgpt';
    alternativesSourceInput.value = lingqOn ? 'lingq' : 'chatgpt';
    phraseSourceInput.value = lingqOn ? 'lingq' : 'chatgpt';
    chatgptModelHelp.textContent = chatgptOn
      ? t('settings.chatgptModelHelpNeedKey')
      : t('settings.chatgptModelHelpOff');
    return;
  }

  newWordSourceChatgptOption.disabled = false;
  alternativesSourceChatgptOption.disabled = false;
  phraseSourceChatgptOption.disabled = false;
  newWordSourceInput.disabled = !lingqOn;
  alternativesSourceInput.disabled = !lingqOn;
  phraseSourceInput.disabled = !lingqOn;

  if (!lingqOn) {
    newWordSourceInput.value = 'chatgpt';
    alternativesSourceInput.value = 'chatgpt';
    phraseSourceInput.value = 'chatgpt';
    newWordSourceHelp.textContent = t('help.newWordOffline');
    alternativesSourceHelp.textContent = t('help.altOffline');
    phraseSourceHelp.textContent = t('help.phraseOffline');
    chatgptModelHelp.textContent = t('settings.chatgptModelHelpShort');
    return;
  }

  newWordSourceInput.value = preferredNewWord === 'chatgpt' ? 'chatgpt' : 'lingq';
  alternativesSourceInput.value = preferredAlternatives === 'chatgpt' ? 'chatgpt' : 'lingq';
  phraseSourceInput.value = preferredPhrase === 'chatgpt' ? 'chatgpt' : 'lingq';
  newWordSourceHelp.textContent = t('help.newWord');
  alternativesSourceHelp.textContent = t('help.alternatives');
  updatePhraseSourceHelp(phraseSourceInput.value === 'chatgpt' ? 'chatgpt' : 'lingq');
  chatgptModelHelp.textContent = t('settings.chatgptModelHelp');
}

function updatePhraseSourceHelp(source) {
  if (!phraseSourceHelp) {
    return;
  }
  if (source === 'chatgpt') {
    phraseSourceHelp.textContent = t('help.phraseChatgpt');
    return;
  }
  phraseSourceHelp.textContent = t('help.phraseLingq');
}

function validateChatgptApiKey(apiKey, options = {}) {
  const key = String(apiKey || '').trim();
  const requestId = ++chatgptValidationRequest;
  if (!key) {
    chatgptApiKeyValid = false;
    if (!options.quiet) {
      setChatgptKeyStatus(t('settings.chatgptNoKey'), 'warn');
    }
    updateChatgptDependentAvailability({
      alternativesSource: 'lingq',
      newWordTranslationSource: 'lingq',
      phraseTranslationSource: 'lingq',
    });
    return Promise.resolve(false);
  }

  if (!options.quiet) {
    setChatgptKeyStatus(t('settings.chatgptValidating'));
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'VALIDATE_CHATGPT_KEY', apiKey: key }, (response) => {
      if (requestId !== chatgptValidationRequest) {
        resolve(chatgptApiKeyValid);
        return;
      }
      if (chrome.runtime.lastError || !response?.ok) {
        chatgptApiKeyValid = false;
        setChatgptKeyStatus(response?.error || chrome.runtime.lastError?.message || t('settings.chatgptInvalid'), 'error');
        updateChatgptDependentAvailability({
          alternativesSource: 'lingq',
          newWordTranslationSource: 'lingq',
          phraseTranslationSource: 'lingq',
        });
        updateLingqAvailability();
        resolve(false);
        return;
      }
      chatgptApiKeyValid = true;
      setChatgptKeyStatus(t('settings.chatgptValid'), 'ok');
      updateChatgptDependentAvailability({
        alternativesSource: alternativesSourceInput.value === 'chatgpt' ? 'chatgpt' : 'lingq',
        newWordTranslationSource: newWordSourceInput.value === 'chatgpt' ? 'chatgpt' : 'lingq',
        phraseTranslationSource: phraseSourceInput.value === 'chatgpt' ? 'chatgpt' : 'lingq',
      });
      updateLingqAvailability();
      resolve(true);
    });
  });
}

chrome.runtime.sendMessage({ type: 'NOTE_ACTIVITY' });

toggleKeyButton.addEventListener('click', () => {
  const showing = apiKeyInput.type === 'text';
  apiKeyInput.type = showing ? 'password' : 'text';
  toggleKeyButton.textContent = showing ? t('settings.show') : t('settings.hide');
});

toggleChatgptKeyButton.addEventListener('click', () => {
  const showing = chatgptApiKeyInput.type === 'text';
  chatgptApiKeyInput.type = showing ? 'password' : 'text';
  toggleChatgptKeyButton.textContent = showing ? t('settings.show') : t('settings.hide');
});

toggleSupabaseKeyButton.addEventListener('click', () => {
  const showing = supabaseKeyInput.type === 'text';
  supabaseKeyInput.type = showing ? 'password' : 'text';
  toggleSupabaseKeyButton.textContent = showing ? t('settings.show') : t('settings.hide');
});

checkSupabaseDbButton.addEventListener('click', () => {
  runSupabaseDbCheck();
});

installSupabaseDbButton.addEventListener('click', () => {
  runSupabaseDbInstall();
});

wordSearchInput.addEventListener('input', () => {
  if (wordSearchTimer) {
    clearTimeout(wordSearchTimer);
  }
  wordSearchTimer = setTimeout(() => {
    wordSearchTimer = null;
    const query = wordSearchInput.value.trim();
    if (query) {
      loadWordsFilter({ mode: 'search', query });
    } else if (wordLetterFilter) {
      loadWordsFilter({ mode: wordLetterFilter === 'TOP' ? 'top' : 'letter', letter: wordLetterFilter });
    } else {
      wordsBucket = [];
      renderWordLetters();
      renderWords();
    }
  }, 300);
});

wordStatusFilterInput.addEventListener('change', () => {
  const query = wordSearchInput.value.trim();
  if (query) {
    loadWordsFilter({ mode: 'search', query, force: true });
  } else if (wordLetterFilter) {
    loadWordsFilter({
      mode: wordLetterFilter === 'TOP' ? 'top' : 'letter',
      letter: wordLetterFilter,
      force: true,
    });
  } else {
    renderWords();
  }
});

wordSortInput.addEventListener('change', () => {
  renderWords();
});

if (wordsLetters) {
  wordsLetters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-letter]');
    if (!button || button.disabled) {
      return;
    }
    const next = button.getAttribute('data-letter');
    if (!next) {
      return;
    }
    wordLetterFilter = next;
    wordSearchInput.value = '';
    renderWordLetters();
    loadWordsFilter({
      mode: next === 'TOP' ? 'top' : 'letter',
      letter: next,
    });
  });
}

const imageLightbox = document.getElementById('image-lightbox');
const imageLightboxImg = document.getElementById('image-lightbox-img');
const imageLightboxTitle = document.getElementById('image-lightbox-title');
const imageLightboxClose = document.getElementById('image-lightbox-close');
const imageLightboxX = document.getElementById('image-lightbox-x');
let imageLightboxOpener = null;

function closeImageLightbox() {
  if (!imageLightbox || imageLightbox.hidden) {
    return;
  }
  imageLightbox.hidden = true;
  document.removeEventListener('keydown', onImageLightboxKeydown);
  imageLightboxOpener?.focus();
  imageLightboxOpener = null;
}

function openImageLightbox(opener) {
  if (!imageLightbox || !imageLightboxImg || !opener) {
    return;
  }
  const thumb = opener.querySelector('img');
  const caption = opener.closest('figure')?.querySelector('figcaption')?.textContent?.trim()
    || thumb?.alt
    || t('preview.close');
  imageLightboxImg.src = thumb?.currentSrc || thumb?.src || '';
  imageLightboxImg.alt = thumb?.alt || caption;
  if (imageLightboxTitle) {
    imageLightboxTitle.textContent = caption;
  }
  imageLightboxOpener = opener;
  imageLightbox.hidden = false;
  document.addEventListener('keydown', onImageLightboxKeydown);
  (imageLightboxX || imageLightboxClose)?.focus();
}

function onImageLightboxKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeImageLightbox();
  }
}

document.querySelectorAll('.db-gate__preview-open').forEach((button) => {
  button.addEventListener('click', () => openImageLightbox(button));
});
imageLightboxClose?.addEventListener('click', closeImageLightbox);
imageLightboxX?.addEventListener('click', closeImageLightbox);

function activateTab(tabName) {
  tabButtons.forEach((button) => {
    const active = button.dataset.tab === tabName;
    button.classList.toggle('tab--active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  panelSettings.hidden = tabName !== 'settings';
  panelWords.hidden = tabName !== 'words';
  panelImport.hidden = tabName !== 'import';
  panelStats.hidden = tabName !== 'stats';
  panelLatency.hidden = tabName !== 'latency';
  panelAuthor.hidden = tabName !== 'author';
  applyDbGateUi();
  if (tabName === 'words') {
    loadWords(false);
  }
  if (tabName === 'import') {
    restoreKnownWordsSyncStatus();
  }
  if (tabName === 'stats') {
    loadStats(false);
  }
  if (tabName === 'latency') {
    loadLatency(false);
  }
}

function applyDbGateUi() {
  const settingsScrollTop = getSettingsScrollBody()?.scrollTop;
  [panelWords, panelImport, panelStats, panelLatency].forEach((panel) => {
    if (!panel) {
      return;
    }
    panel.classList.toggle('is-db-locked', !supabaseReady);
    panel.querySelectorAll('[data-db-gate]').forEach((gate) => {
      gate.hidden = supabaseReady;
    });
  });
  if (dbModeAlert) {
    // Bez připravené / zapnuté DB doplněk běží jen přes LingQ API.
    dbModeAlert.hidden = supabaseReady;
  }
  if (syncKnownWordsButton) {
    syncKnownWordsButton.disabled = !supabaseReady;
  }
  if (resetLingqImportButton) {
    resetLingqImportButton.disabled = !supabaseReady;
  }
  if (highlightEnabledInput) {
    highlightEnabledInput.disabled = !supabaseReady || importLocksHighlight;
    const highlightHeader = highlightEnabledInput.closest('.settings-section__header');
    highlightHeader?.classList.toggle('is-disabled', !supabaseReady || importLocksHighlight);
    if (!supabaseReady || importLocksHighlight) {
      highlightEnabledInput.checked = false;
    } else {
      // Po opětovném připojení DB obnov preferenci ze storage.
      chrome.storage.sync.get({ highlightEnabled: true }, (settings) => {
        if (!importLocksHighlight) {
          highlightEnabledInput.checked = settings.highlightEnabled !== false;
        }
      });
    }
  }
  // Zobrazení/skrytí banneru mění výšku chrome — nenech focus odscrollovat menu.
  if (panelSettings && !panelSettings.hidden) {
    afterSettingsLayout(settingsScrollTop);
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
      return;
    }
    if (updateAlert) {
      updateAlert.hidden = true;
    }
  });
});

function resolveDbStatusText(response = {}) {
  if (response.messageKey) {
    return t(response.messageKey, response.messageParams || {});
  }
  if (response.ready) {
    return t('db.ready', {
      version: response.expectedVersion || response.installedVersion || '?',
    });
  }
  return response.message
    || response.error
    || t('settings.dbNotReady');
}

function refreshSupabaseGate({ force = false } = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_SUPABASE_STATUS', force }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        supabaseReady = false;
        supabaseSchemaNeedsUpdate = false;
        supabaseGateMessage = resolveDbStatusText({
          message: response?.error || chrome.runtime.lastError?.message,
        });
        applySchemaUpdateAlert({});
        if (supabaseDbStatus) {
          setSupabaseDbStatus(supabaseGateMessage, 'error');
        }
      } else {
        supabaseReady = response.ready === true;
        supabaseGateMessage = resolveDbStatusText(response);
        const configured = response.configured === true && response.enabled !== false;
        const versionMismatch = configured
          && response.structureOk === true
          && response.versionOk === false;
        const missingVersion = configured
          && response.structureOk === true
          && !response.installedVersion
          && response.ready !== true;
        // I když chybí celé schéma po upgrade doplňku, upozorni stejně výrazně.
        const schemaBroken = configured
          && response.ready !== true
          && response.structureOk === false;
        supabaseSchemaNeedsUpdate = Boolean(versionMismatch || missingVersion || schemaBroken);
        applySchemaUpdateAlert(response);
        if (supabaseDbStatus && (response.messageKey || response.ready || response.message)) {
          const tone = response.ready ? 'ok' : (response.structureOk ? 'warn' : 'error');
          setSupabaseDbStatus(supabaseGateMessage, response.ready || response.structureOk ? tone : 'error');
        }
      }
      applyDbGateUi();
      updateLingqAvailability();
      resolve({ ready: supabaseReady, message: supabaseGateMessage });
    });
  });
}

function applySchemaUpdateAlert(response = {}) {
  if (!schemaAlert) {
    return;
  }
  if (!supabaseSchemaNeedsUpdate) {
    schemaAlert.hidden = true;
    return;
  }
  const expected = response.expectedVersion || '?';
  const installed = response.installedVersion || t('settings.schemaUnknown');
  if (schemaAlertText) {
    if (response.structureOk === false) {
      schemaAlertText.textContent = t('settings.schemaBroken', { expected });
    } else {
      schemaAlertText.textContent = t('settings.schemaMismatch', { expected, installed });
    }
  }
  schemaAlert.hidden = false;
}

schemaAlertOpenSettings?.addEventListener('click', () => {
  activateTab('settings');
  const settingsBody = getSettingsScrollBody();
  const supabaseSection = document.getElementById('settings-supabase-title');
  if (settingsBody && supabaseSection) {
    const bodyRect = settingsBody.getBoundingClientRect();
    const sectionRect = supabaseSection.getBoundingClientRect();
    settingsBody.scrollTop += sectionRect.top - bodyRect.top - 8;
  }
  afterSettingsLayout(settingsBody?.scrollTop);
});

function normalizeIdleRange(settings = {}) {
  let min = Number(settings.latencyIdleMinSeconds ?? settings.latencyIdleSeconds);
  let max = Number(settings.latencyIdleMaxSeconds);
  if (!Number.isFinite(min)) {
    min = 60;
  }
  if (!Number.isFinite(max)) {
    max = Number.isFinite(Number(settings.latencyIdleSeconds)) ? Number(settings.latencyIdleSeconds) + 20 : 80;
  }
  min = Math.min(3600, Math.max(30, Math.round(min)));
  max = Math.min(3600, Math.max(30, Math.round(max)));
  if (max < min) {
    const swap = min;
    min = max;
    max = swap;
  }
  return { min, max };
}

function readIdleRange() {
  const range = normalizeIdleRange({
    latencyIdleMinSeconds: latencyIdleMinInput.value,
    latencyIdleMaxSeconds: latencyIdleMaxInput.value,
  });
  return {
    latencyIdleMinSeconds: range.min,
    latencyIdleMaxSeconds: range.max,
  };
}

function formatDuration(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) {
    return '—';
  }
  const value = Number(ms);
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  return `${(value / 1000).toFixed(1).replace('.', ',')} s`;
}

function latencyRows(latency) {
  if (!latency) {
    return [];
  }
  if (latency.error) {
    return [[t('tab.latency'), latency.error]];
  }
  const sourceLabel = {
    click: t('latency.legendClick'),
    idle: t('latency.legendIdle'),
    probe: t('latency.legendIdle'),
    phrase: t('latency.legendPhrase'),
  };
  const last = latency.lastMs == null
    ? '—'
    : `${formatDuration(latency.lastMs)} · ${sourceLabel[latency.lastSource] || '—'}${latency.lastOk === false ? ' · ✕' : ''}`;
  const statusRows = [
    ['new', t('latency.knowledge', { level: 'new' })],
    ['1', t('latency.knowledge', { level: '1' })],
    ['2', t('latency.knowledge', { level: '2' })],
    ['3', t('latency.knowledge', { level: '3' })],
    ['4', t('latency.knowledge', { level: '4' })],
    ['K', t('latency.knowledge', { level: 'K' })],
  ].map(([key, label]) => {
    const item = latency.byStatus?.[key];
    if (!item?.count) {
      return [label, '—'];
    }
    return [label, `${formatDuration(item.avgMs)} (${item.count}×)`];
  });
  return [
    [t('latency.avg'), formatDuration(latency.avgMs)],
    [t('latency.afterClick'), latency.clickCount ? `${formatDuration(latency.clickAvgMs)} (${latency.clickCount}×)` : '—'],
    [t('latency.idleProbe'), latency.probeCount ? `${formatDuration(latency.probeAvgMs)} (${latency.probeCount}×)` : '—'],
    [t('latency.phrase'), latency.phraseCount ? `${formatDuration(latency.phraseAvgMs)} (${latency.phraseCount}×)` : '—'],
    ...statusRows,
    [t('latency.last'), last],
  ];
}

function averageLatencyByHour(points) {
  const buckets = new Map();
  (points || []).forEach((point) => {
    const date = new Date(point.t);
    if (Number.isNaN(date.getTime())) {
      return;
    }
    date.setMinutes(0, 0, 0);
    const key = date.getTime();
    const bucket = buckets.get(key) || { sum: 0, count: 0 };
    bucket.sum += Number(point.ms) || 0;
    bucket.count += 1;
    buckets.set(key, bucket);
  });
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, bucket]) => ({
      t,
      ms: Math.round(bucket.sum / Math.max(1, bucket.count)),
      count: bucket.count,
    }));
}

function renderLatencyWeekChart(week) {
  latencyChart.innerHTML = '';
  const clickHourly = averageLatencyByHour(week?.click);
  const idleHourly = averageLatencyByHour(week?.idle);
  const phraseHourly = averageLatencyByHour(week?.phrase);
  if (!week || (clickHourly.length === 0 && idleHourly.length === 0 && phraseHourly.length === 0)) {
    latencyChart.innerHTML = `<div class="latency-chart__empty">${t('latency.empty')}</div>`;
    return;
  }

  const width = Math.max(640, Math.round(latencyChart.clientWidth) || 1060);
  const height = 168;
  const pad = { top: 12, right: 14, bottom: 28, left: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const points = [...clickHourly, ...idleHourly, ...phraseHourly];
  const start = week.from ? new Date(week.from) : new Date(Math.min(...points.map((p) => p.t)));
  start.setHours(0, 0, 0, 0);
  const end = week.to ? new Date(week.to) : new Date();
  const minT = start.getTime();
  const maxT = Math.max(end.getTime(), minT + 1);
  const allMs = points.map((p) => Number(p.ms) || 0);
  const niceMax = niceLatencyMax(latencyChartScaleMax(allMs));
  const axisUnit = niceMax >= 1000 ? 's' : 'ms';

  const xOf = (t) => pad.left + ((Number(t) - minT) / (maxT - minT)) * plotW;
  const yOf = (ms) => pad.top + plotH - (Math.min(Number(ms) || 0, niceMax) / niceMax) * plotH;

  const dayLines = [];
  const dayLabels = [];
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() + 1);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() < maxT) {
    const x = xOf(cursor.getTime());
    dayLines.push(`<line class="latency-day" x1="${x.toFixed(1)}" y1="${pad.top}" x2="${x.toFixed(1)}" y2="${(pad.top + plotH).toFixed(1)}" />`);
    cursor.setDate(cursor.getDate() + 1);
  }
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + offset);
    day.setHours(12, 0, 0, 0);
    if (day.getTime() > maxT) {
      break;
    }
    const x = xOf(day.getTime());
    dayLabels.push(`<text class="latency-day-label" x="${x.toFixed(1)}" y="${height - 8}">${formatChartDay(day)}</text>`);
  }

  const ticks = latencyYTicks(niceMax);
  const grid = ticks.map((ms) => {
    const y = yOf(ms);
    return `<line class="latency-grid" x1="${pad.left}" y1="${y.toFixed(1)}" x2="${(pad.left + plotW).toFixed(1)}" y2="${y.toFixed(1)}" /><text class="latency-y" x="${pad.left - 6}" y="${(y + 3).toFixed(1)}">${formatChartAxisMs(ms, axisUnit)}</text>`;
  }).join('');

  latencyChart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${t('latency.chartAria')}">
    <rect class="latency-plot" x="${pad.left}" y="${pad.top}" width="${plotW}" height="${plotH}" />
    ${grid}
    ${dayLines.join('')}
    ${polylinePath(idleHourly, xOf, yOf, 'latency-line latency-line--idle')}
    ${polylinePath(clickHourly, xOf, yOf, 'latency-line latency-line--click')}
    ${polylinePath(phraseHourly, xOf, yOf, 'latency-line latency-line--phrase')}
    ${dotsMarkup(idleHourly, xOf, yOf, 'latency-dot latency-dot--idle')}
    ${dotsMarkup(clickHourly, xOf, yOf, 'latency-dot latency-dot--click')}
    ${dotsMarkup(phraseHourly, xOf, yOf, 'latency-dot latency-dot--phrase')}
    ${dayLabels.join('')}
  </svg>`;
}

function latencyChartScaleMax(allMs) {
  const values = (allMs || [])
    .map((value) => Number(value) || 0)
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  if (values.length === 0) {
    return 1000;
  }
  const absoluteMax = values[values.length - 1];
  // Občasné špičky (např. 15 s) by jinak natáhly osu a průměry ze statistiky by „neseděly“.
  if (values.length >= 8) {
    const p95 = values[Math.min(values.length - 1, Math.floor(values.length * 0.95))];
    const median = values[Math.floor(values.length / 2)];
    return Math.max(p95, median * 2, 500);
  }
  return Math.max(absoluteMax, 500);
}

function niceLatencyMax(maxMs) {
  const value = Math.max(200, Number(maxMs) || 200);
  const step = value <= 1000 ? 100 : value <= 5000 ? 500 : 1000;
  return Math.ceil(value / step) * step;
}

function latencyYTicks(maxMs) {
  const count = 4;
  const ticks = [];
  for (let i = 0; i <= count; i += 1) {
    ticks.push(Math.round((maxMs * i) / count));
  }
  return ticks;
}

function formatChartAxisMs(ms, unit) {
  const value = Math.max(0, Number(ms) || 0);
  if (unit === 's') {
    const seconds = value / 1000;
    const rounded = Math.round(seconds * 10) / 10;
    const text = Number.isInteger(rounded)
      ? String(rounded)
      : rounded.toFixed(1).replace('.', ',');
    return `${text} s`;
  }
  return `${Math.round(value)} ms`;
}

function formatChartDay(date) {
  return new Intl.DateTimeFormat(uiDateLocale(), { weekday: 'short', day: 'numeric' }).format(date);
}

function polylinePath(points, xOf, yOf, className) {
  if (!points.length) {
    return '';
  }
  const coords = points
    .map((point) => `${xOf(point.t).toFixed(1)},${yOf(point.ms).toFixed(1)}`)
    .join(' ');
  return `<polyline class="${className}" fill="none" points="${coords}" />`;
}

function dotsMarkup(points, xOf, yOf, className) {
  return points.map((point) => {
    const hour = new Date(point.t);
    const hourLabel = Number.isNaN(hour.getTime())
      ? ''
      : `${formatChartDay(hour)} ${String(hour.getHours()).padStart(2, '0')}:00`;
    const countLabel = point.count ? ` · ${point.count}×` : '';
    return `<circle class="${className}" cx="${xOf(point.t).toFixed(1)}" cy="${yOf(point.ms).toFixed(1)}" r="2.4"><title>${hourLabel} · ${formatDuration(point.ms)}${countLabel}</title></circle>`;
  }).join('');
}

function renderClickHelp(clickCount) {
  clickHelp.textContent = Number(clickCount) === 2
    ? t('settings.clickHelp2')
    : t('settings.clickHelp1');
}

function setKnownWordsStatus(message, tone = '') {
  importKnownStatus.textContent = message || '';
  importKnownStatus.classList.remove('words-import-status--ok', 'words-import-status--error');
  if (tone === 'ok') {
    importKnownStatus.classList.add('words-import-status--ok');
  } else if (tone === 'error') {
    importKnownStatus.classList.add('words-import-status--error');
  }
}

function setSupabaseDbStatus(message, tone = '') {
  supabaseDbStatus.textContent = message || '';
  supabaseDbStatus.classList.remove('db-install-status--ok', 'db-install-status--error', 'db-install-status--warn');
  if (tone === 'ok') {
    supabaseDbStatus.classList.add('db-install-status--ok');
  } else if (tone === 'error') {
    supabaseDbStatus.classList.add('db-install-status--error');
  } else if (tone === 'warn') {
    supabaseDbStatus.classList.add('db-install-status--warn');
  }
}

function readSupabaseFormSettings() {
  return {
    supabaseUrl: supabaseUrlInput.value.trim().replace(/\/$/, ''),
    supabaseKey: supabaseKeyInput.value.trim(),
  };
}

function persistSupabaseFormSettings() {
  const settings = readSupabaseFormSettings();
  return Promise.all([
    setExtensionPrefs({ supabaseUrl: settings.supabaseUrl }),
    setExtensionSecrets({ supabaseKey: settings.supabaseKey }),
  ]).then(() => settings);
}

async function runSupabaseDbCheck() {
  checkSupabaseDbButton.disabled = true;
  installSupabaseDbButton.disabled = true;
  setSupabaseDbStatus(t('settings.dbChecking'));
  try {
    const settings = await persistSupabaseFormSettings();
    chrome.runtime.sendMessage({ type: 'CHECK_SUPABASE_SCHEMA', settings }, (response) => {
      checkSupabaseDbButton.disabled = false;
      installSupabaseDbButton.disabled = false;
      if (chrome.runtime.lastError || !response?.ok) {
        setSupabaseDbStatus(
          response?.error || chrome.runtime.lastError?.message || t('settings.dbCheckFailed'),
          'error',
        );
        return;
      }
      const tone = response.ready ? 'ok' : (response.structureOk ? 'warn' : 'error');
      const statusText = resolveDbStatusText(response);
      setSupabaseDbStatus(statusText, tone);
      supabaseReady = response.ready === true;
      supabaseGateMessage = statusText;
      supabaseSchemaNeedsUpdate = response.ready !== true;
      applySchemaUpdateAlert({
        ...response,
        configured: true,
        expectedVersion: response.expectedVersion,
        installedVersion: response.installedVersion,
      });
      applyDbGateUi();
      updateLingqAvailability();
      if (supabaseReady) {
        resetWordsCache();
        latencyLoaded = false;
      }
    });
  } catch (error) {
    checkSupabaseDbButton.disabled = false;
    installSupabaseDbButton.disabled = false;
    setSupabaseDbStatus(error instanceof Error ? error.message : t('settings.dbCheckFailed'), 'error');
  }
}

async function runSupabaseDbInstall() {
  checkSupabaseDbButton.disabled = true;
  installSupabaseDbButton.disabled = true;
  setSupabaseDbStatus(t('settings.dbInstalling'));
  try {
    const settings = await persistSupabaseFormSettings();
    chrome.runtime.sendMessage({ type: 'PREPARE_SUPABASE_INSTALL', settings }, async (response) => {
      checkSupabaseDbButton.disabled = false;
      installSupabaseDbButton.disabled = false;
      if (chrome.runtime.lastError || !response?.ok) {
        setSupabaseDbStatus(
          response?.error || chrome.runtime.lastError?.message || t('settings.dbInstallFailed'),
          'error',
        );
        return;
      }

      if (response.ready) {
        const statusText = resolveDbStatusText(response) || t('settings.dbAlreadyCurrent');
        setSupabaseDbStatus(statusText, 'ok');
        supabaseReady = true;
        supabaseSchemaNeedsUpdate = false;
        supabaseGateMessage = statusText;
        applySchemaUpdateAlert({});
        applyDbGateUi();
        updateLingqAvailability();
        resetWordsCache();
        latencyLoaded = false;
        return;
      }
      supabaseReady = false;
      supabaseSchemaNeedsUpdate = true;
      applySchemaUpdateAlert({
        configured: true,
        structureOk: response.structureOk,
        versionOk: response.versionOk,
        expectedVersion: response.expectedVersion,
        installedVersion: response.installedVersion,
      });
      applyDbGateUi();
      updateLingqAvailability();

      try {
        await navigator.clipboard.writeText(response.sql || '');
      } catch {
        setSupabaseDbStatus(t('settings.dbClipboardFailed'), 'error');
        if (response.editorUrl) {
          window.open(response.editorUrl, '_blank', 'noopener,noreferrer');
        }
        return;
      }

      if (response.editorUrl) {
        window.open(response.editorUrl, '_blank', 'noopener,noreferrer');
      }
      setSupabaseDbStatus(
        `${resolveDbStatusText(response)} ${t('settings.dbSqlCopiedTail', { n: formatKnownCount(response.fileCount) })}`.trim(),
        'warn',
      );
    });
  } catch (error) {
    checkSupabaseDbButton.disabled = false;
    installSupabaseDbButton.disabled = false;
    setSupabaseDbStatus(error instanceof Error ? error.message : t('settings.dbInstallFailed'), 'error');
  }
}

function applyChatgptModelLabels() {
  if (!chatgptModelInput) {
    return;
  }
  const perMillion = t('settings.perMillion');
  chatgptModelInput.querySelectorAll('option').forEach((option) => {
    const prices = CHATGPT_MODEL_PRICES[option.value];
    if (!prices) {
      return;
    }
    option.textContent = `${option.value} — $${prices.input} / $${prices.output} ${perMillion}`;
  });
}

function formatKnownCount(value) {
  return new Intl.NumberFormat(uiDateLocale()).format(Number(value) || 0);
}

function formatCooldown(ms) {
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

function importBatchesNeeded(count, batchSize) {
  const n = Math.max(0, Number(count) || 0);
  const size = Math.max(1, Number(batchSize) || 500);
  if (n <= 0) {
    return 0;
  }
  return Math.ceil(n / size);
}

/** Odhad zbývající doby: zbývající dávky × (pauza + práce) + aktuální cooldown. */
function estimateImportRemainingMs(progress) {
  if (!progress || progress.phase === 'done') {
    return 0;
  }
  const batchSize = Math.max(1, Number(progress.batchSize) || 500);
  const cooldownMs = Math.max(0, Number(progress.cooldownMs) || 5_000);
  const workMs = Math.max(
    IMPORT_BATCH_WORK_MS,
    Number(progress.lastBatchDurationMs) || 0,
  );
  const perBatchMs = cooldownMs + workMs;

  const cardsLeft = Math.max(0, (Number(progress.totalCards) || 0) - (Number(progress.importedCards) || 0));
  const knownLeft = Math.max(0, (Number(progress.knownTotal) || 0) - (Number(progress.knownImported) || 0));

  let batches = 0;
  if (progress.phase === 'cards') {
    batches = importBatchesNeeded(cardsLeft, batchSize)
      + importBatchesNeeded(Number(progress.knownTotal) || 0, batchSize);
  } else if (progress.phase === 'known') {
    batches = importBatchesNeeded(knownLeft, batchSize);
  } else {
    batches = importBatchesNeeded(cardsLeft + knownLeft, batchSize);
  }

  // Probíhající dávka: už nepočítat plnou pauzu navíc, jen zbývající cooldown.
  if (progress.running && batches > 0) {
    batches -= 1;
  }

  const cooldownLeft = Math.max(0, Number(progress.cooldownRemainingMs)
    || (Number(progress.cooldownUntil) || 0) - Date.now());
  return Math.max(0, batches * perBatchMs + cooldownLeft);
}

function formatImportEtaText(progress) {
  const ms = estimateImportRemainingMs(progress);
  if (!progress || progress.phase === 'done') {
    return '';
  }
  if (ms <= 0 && !progress.running) {
    const batchSize = Math.max(1, Number(progress.batchSize) || 500);
    const cooldownMs = Math.max(0, Number(progress.cooldownMs) || 5_000);
    const cards = Number(progress.totalCards) || 0;
    const known = Number(progress.knownTotal) || 0;
    const totalBatches = importBatchesNeeded(cards, batchSize) + importBatchesNeeded(known, batchSize);
    if (totalBatches <= 0) {
      return '';
    }
    const totalMs = totalBatches * (cooldownMs + IMPORT_BATCH_WORK_MS);
    return t('import.eta.total', { time: formatCooldown(totalMs) });
  }
  return t('import.eta.remaining', { time: formatCooldown(Math.max(ms, 1_000)) });
}

function clearImportCooldownTimer() {
  if (importCooldownTimer) {
    window.clearInterval(importCooldownTimer);
    importCooldownTimer = null;
  }
}

function updateImportProgressUi(progress) {
  if (!progress) {
    importProgress.hidden = true;
    if (importProgressEta) {
      importProgressEta.hidden = true;
      importProgressEta.textContent = '';
    }
    return;
  }
  importProgress.hidden = false;
  const cardsImported = Number(progress.importedCards) || 0;
  const cardsTotal = Number(progress.totalCards) || 0;
  const knownImported = Number(progress.knownImported) || 0;
  const knownTotal = Number(progress.knownTotal) || 0;
  importCardsNumbers.textContent = `${formatKnownCount(cardsImported)} / ${formatKnownCount(cardsTotal)}`;
  importKnownNumbers.textContent = `${formatKnownCount(knownImported)} / ${formatKnownCount(knownTotal)}`;

  const phaseLabel = progress.phase === 'known'
    ? t('import.phaseNowKnown')
    : (progress.phase === 'done' ? t('import.phaseDoneBoth') : t('import.phaseNowCards'));
  const imported = Number(progress.axisImported) || 0;
  const total = Number(progress.axisTotal) || 0;
  const percent = Number(progress.axisPercent) || 0;
  importProgressPhase.textContent = phaseLabel;
  importProgressNumbers.textContent = `${formatKnownCount(imported)} / ${formatKnownCount(total)}`;
  importProgressTotalLabel.textContent = formatKnownCount(total);
  importProgressFill.style.width = `${percent}%`;
  importProgressBar.setAttribute('aria-valuenow', String(percent));

  if (importProgressEta) {
    const etaText = progress.phase === 'done' ? '' : formatImportEtaText(progress);
    importProgressEta.hidden = !etaText;
    importProgressEta.textContent = etaText;
  }
}

function resolveImportStatusText(progress) {
  if (!progress) {
    return '';
  }
  if (progress.messageKey) {
    const params = { ...(progress.messageParams || {}) };
    ['n', 'total', 'inserted', 'updated'].forEach((key) => {
      if (params[key] != null) {
        params[key] = formatKnownCount(params[key]);
      }
    });
    return t(progress.messageKey, params);
  }
  if (progress.running) {
    return progress.message || t('import.msg.working');
  }
  if (progress.phase === 'done') {
    return t('import.msg.doneStats', {
      inserted: formatKnownCount(progress.insertedTotal),
      updated: formatKnownCount(progress.updatedTotal),
    });
  }
  if (progress.phase === 'cards') {
    return t('import.msg.cardsBatch', {
      n: formatKnownCount(progress.importedCards),
      total: formatKnownCount(progress.totalCards),
    });
  }
  if (progress.phase === 'known') {
    const knownImported = Number(progress.knownImported) || 0;
    if (knownImported <= 0) {
      return t('import.msg.cardsDone', { n: formatKnownCount(progress.importedCards) });
    }
    return t('import.msg.knownBatch', {
      n: formatKnownCount(knownImported),
      total: formatKnownCount(progress.knownTotal),
    });
  }
  return progress.message || t('import.msg.ready');
}

function renderKnownWordsSyncProgress(progress) {
  clearImportCooldownTimer();
  renderImportHighlightAlert(progress);
  if (!progress) {
    syncKnownWordsButton.disabled = false;
    syncKnownWordsButton.textContent = t('import.button');
    resetLingqImportButton.disabled = false;
    updateImportProgressUi(null);
    return;
  }

  updateImportProgressUi(progress);
  resetLingqImportButton.disabled = Boolean(progress.running);

  if (progress.running) {
    syncKnownWordsButton.disabled = true;
    syncKnownWordsButton.textContent = t('import.running');
    setKnownWordsStatus(resolveImportStatusText(progress));
    return;
  }

  if (progress.phase === 'done') {
    syncKnownWordsButton.disabled = true;
    syncKnownWordsButton.textContent = t('import.done');
    setKnownWordsStatus(resolveImportStatusText(progress), 'ok');
    return;
  }

  const cooldownRemaining = Number(progress.cooldownRemainingMs) || 0;
  if (cooldownRemaining > 0) {
    syncKnownWordsButton.disabled = true;
    const tick = () => {
      const left = Math.max(0, Number(progress.cooldownUntil) - Date.now());
      if (left <= 0) {
        clearImportCooldownTimer();
        restoreKnownWordsSyncStatus();
        return;
      }
      const live = {
        ...progress,
        cooldownRemainingMs: left,
      };
      syncKnownWordsButton.textContent = t('import.nextIn', { time: formatCooldown(left) });
      setKnownWordsStatus(
        `${resolveImportStatusText(progress)} ${t('import.msg.cooldownHint')} ${formatImportEtaText(live)}`,
        'ok',
      );
      updateImportProgressUi(live);
      renderImportHighlightAlert(live);
    };
    tick();
    importCooldownTimer = window.setInterval(tick, 1000);
    return;
  }

  syncKnownWordsButton.disabled = false;
  const batch = Number(progress.batchSize) || 500;
  syncKnownWordsButton.textContent = t('import.buttonN', { n: formatKnownCount(batch) });
  if (progress.error) {
    setKnownWordsStatus(progress.error, 'error');
  } else if (progress.message || progress.messageKey || progress.phase) {
    setKnownWordsStatus(resolveImportStatusText(progress), 'ok');
  } else {
    setKnownWordsStatus(t('import.msg.ready'));
  }
}

function restoreKnownWordsSyncStatus() {
  if (!supabaseReady) {
    applyDbGateUi();
    setKnownWordsStatus(supabaseGateMessage, 'error');
    return;
  }
  chrome.runtime.sendMessage({ type: 'GET_KNOWN_WORDS_SYNC_STATUS', refreshTotals: false }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      if (response?.error) {
        setKnownWordsStatus(response.error, 'error');
      }
      return;
    }
    renderKnownWordsSyncProgress(response.progress);
  });
}

function startKnownWordsSync() {
  if (!supabaseReady) {
    setKnownWordsStatus(supabaseGateMessage, 'error');
    applyDbGateUi();
    return;
  }
  syncKnownWordsButton.disabled = true;
  syncKnownWordsButton.textContent = t('import.running');
  setKnownWordsStatus(t('import.startingBatch'));
  chrome.runtime.sendMessage({ type: 'SYNC_KNOWN_WORDS' }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      setKnownWordsStatus(
        response?.error || chrome.runtime.lastError?.message || t('import.err.failed'),
        'error',
      );
      restoreKnownWordsSyncStatus();
      return;
    }
    renderKnownWordsSyncProgress(response);
    resetWordsCache();
    loadWords(true);
  });
}

function resetWordsCache() {
  wordsCache = new Map();
  wordsLetterCounts = Object.create(null);
  wordsEmptyLetters = new Set();
  wordsBucket = [];
  wordsTotalInDb = null;
  wordsIndexReady = false;
  wordsLoaded = false;
}

function wordsCacheKey(mode, letter, query, status) {
  return `${mode}|${letter || ''}|${String(query || '').toLowerCase()}|${status || 'all'}`;
}

function renderWordLetters() {
  if (!wordsLetters) {
    return;
  }
  const searching = Boolean(wordSearchInput.value.trim());
  const dbEmpty = wordsIndexReady && wordsTotalInDb === 0;
  wordsLetters.innerHTML = '';

  const topButton = document.createElement('button');
  topButton.type = 'button';
  topButton.className = 'words-letter words-letter--top';
  topButton.dataset.letter = 'TOP';
  topButton.textContent = t('words.letterTop');
  topButton.title = t('words.letterTopTitle', { n: WORDS_TOP_RENDER_CAP });
  topButton.disabled = dbEmpty;
  topButton.setAttribute('aria-pressed', !searching && wordLetterFilter === 'TOP' ? 'true' : 'false');
  if (!searching && wordLetterFilter === 'TOP') {
    topButton.classList.add('words-letter--active');
  }
  wordsLetters.appendChild(topButton);

  WORD_LETTER_KEYS.forEach((letter) => {
    const knownCount = wordsLetterCounts[letter];
    const isEmpty = wordsEmptyLetters.has(letter) || knownCount === 0;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'words-letter';
    button.dataset.letter = letter;
    button.textContent = letter;
    button.disabled = dbEmpty || isEmpty;
    if (typeof knownCount === 'number' && knownCount > 0) {
      button.title = t('words.letterTitle', { letter, n: knownCount });
    } else if (isEmpty) {
      button.title = t('words.letterEmpty', { letter });
    } else {
      button.title = t('words.letterLoad', { letter });
    }
    button.setAttribute('aria-pressed', !searching && wordLetterFilter === letter ? 'true' : 'false');
    if (!searching && wordLetterFilter === letter) {
      button.classList.add('words-letter--active');
    }
    wordsLetters.appendChild(button);
  });
}

function loadWords(force) {
  if (!supabaseReady) {
    resetWordsCache();
    wordsMeta.textContent = '';
    wordsList.innerHTML = '';
    if (wordsLetters) {
      wordsLetters.innerHTML = '';
    }
    applyDbGateUi();
    return;
  }

  if (force) {
    const previousLetter = wordLetterFilter;
    const previousQuery = wordSearchInput.value.trim();
    resetWordsCache();
    wordLetterFilter = previousLetter;
    renderWordLetters();
    if (previousQuery) {
      loadWordsFilter({ mode: 'search', query: previousQuery, force: true });
      return;
    }
    if (previousLetter) {
      loadWordsFilter({
        mode: previousLetter === 'TOP' ? 'top' : 'letter',
        letter: previousLetter,
        force: true,
      });
      return;
    }
  }

  if (wordsIndexReady && !force) {
    renderWordLetters();
    renderWords();
    return;
  }

  wordsMeta.textContent = t('words.loadingIndex');
  wordsList.innerHTML = '';
  chrome.runtime.sendMessage({ type: 'COUNT_SUPABASE_WORDS' }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      wordsIndexReady = false;
      wordsMeta.textContent = '';
      setEmptyMessage(wordsList, response?.error || chrome.runtime.lastError?.message || t('words.loadFailed'));
      return;
    }
    wordsTotalInDb = Number(response.total) || 0;
    wordsIndexReady = true;
    wordsLoaded = true;
    renderWordLetters();
    renderWords();
  });
}

function loadWordsFilter({ mode, letter = null, query = '', force = false } = {}) {
  if (!supabaseReady) {
    applyDbGateUi();
    return;
  }

  const statusFilter = wordStatusFilterInput.value;
  const cacheKey = wordsCacheKey(mode, letter, query, statusFilter);
  if (!force && wordsCache.has(cacheKey)) {
    wordsBucket = wordsCache.get(cacheKey).slice();
    if (mode === 'letter' && letter) {
      wordsLetterCounts[letter] = wordsBucket.length;
      if (wordsBucket.length === 0) {
        wordsEmptyLetters.add(letter);
      } else {
        wordsEmptyLetters.delete(letter);
      }
    }
    renderWordLetters();
    renderWords();
    return;
  }

  const token = ++wordsLoadToken;
  wordsLoading = true;
  wordsMeta.textContent = mode === 'search'
    ? t('words.loadingSearch')
    : mode === 'top'
      ? t('words.loadingTop')
      : t('words.loadingLetter', { letter: letter || '?' });
  wordsList.innerHTML = '';

  chrome.runtime.sendMessage({
    type: 'LIST_SUPABASE_WORDS_FILTER',
    mode,
    letter,
    query,
    status: statusFilter === 'all' ? null : statusFilter,
    limit: mode === 'top' ? WORDS_TOP_RENDER_CAP : mode === 'search' ? WORDS_SEARCH_LIMIT : undefined,
  }, (response) => {
    if (token !== wordsLoadToken) {
      return;
    }
    wordsLoading = false;
    if (chrome.runtime.lastError || !response?.ok) {
      wordsBucket = [];
      setEmptyMessage(wordsList, response?.error || chrome.runtime.lastError?.message || t('words.loadFailed'));
      wordsMeta.textContent = '';
      return;
    }

    wordsBucket = Array.isArray(response.words) ? response.words : [];
    wordsCache.set(cacheKey, wordsBucket.slice());
    if (mode === 'letter' && letter) {
      const count = response.total != null ? Number(response.total) : wordsBucket.length;
      wordsLetterCounts[letter] = count;
      if (count === 0) {
        wordsEmptyLetters.add(letter);
      } else {
        wordsEmptyLetters.delete(letter);
      }
    }
    if (response.total != null && mode !== 'search' && mode !== 'top' && wordsTotalInDb == null) {
      wordsTotalInDb = Number(response.total);
    }
    renderWordLetters();
    renderWords({
      matchTotal: response.total != null ? Number(response.total) : wordsBucket.length,
    });
  });
}

function renderWords(options = {}) {
  const query = wordSearchInput.value.trim();
  const sort = wordSortInput.value;
  const totalInDb = wordsTotalInDb;
  let items = wordsBucket.slice();
  const matchTotal = Number.isFinite(options.matchTotal) ? options.matchTotal : items.length;

  const effectiveSort = (!query && wordLetterFilter === 'TOP') ? 'views-desc' : sort;
  items.sort((left, right) => {
    const leftWord = String(left.word || '');
    const rightWord = String(right.word || '');
    const leftViews = Number(left.view_count) || 0;
    const rightViews = Number(right.view_count) || 0;
    if (effectiveSort === 'alpha-desc') {
      return rightWord.localeCompare(leftWord, 'cs', { sensitivity: 'base' });
    }
    if (effectiveSort === 'views-desc') {
      return rightViews - leftViews || leftWord.localeCompare(rightWord, 'cs', { sensitivity: 'base' });
    }
    if (effectiveSort === 'views-asc') {
      return leftViews - rightViews || leftWord.localeCompare(rightWord, 'cs', { sensitivity: 'base' });
    }
    return leftWord.localeCompare(rightWord, 'cs', { sensitivity: 'base' });
  });

  renderWordLetters();

  if (wordsIndexReady && totalInDb === 0) {
    wordsMeta.textContent = t('words.emptyDb');
    wordsList.innerHTML = `<div class="words-empty">${t('words.emptyHint')}</div>`;
    return;
  }

  if (query) {
    wordsMeta.textContent = matchTotal > items.length
      ? t('words.searchCapped', {
        n: items.length,
        total: matchTotal,
        all: totalInDb != null ? totalInDb : '…',
      })
      : t('words.searchShown', {
        n: items.length,
        all: totalInDb != null ? totalInDb : '…',
      });
  } else if (!wordLetterFilter) {
    wordsMeta.textContent = totalInDb != null
      ? t('words.pickLetter', { total: totalInDb })
      : t('words.pickLetterUnknown');
    wordsList.innerHTML = `<div class="words-empty">${t('words.pickLetterHint')}</div>`;
    return;
  } else if (wordLetterFilter === 'TOP') {
    wordsMeta.textContent = t('words.topCount', {
      n: items.length,
      total: totalInDb != null ? totalInDb : '…',
    });
  } else {
    wordsMeta.textContent = t('words.letterCount', {
      letter: wordLetterFilter,
      n: items.length,
      total: totalInDb != null ? totalInDb : '…',
    });
  }

  if (items.length === 0) {
    const emptyText = query
      ? t('words.noFilter')
      : wordLetterFilter === 'TOP'
        ? t('words.noFilter')
        : t('words.letterNoWords', { letter: wordLetterFilter });
    wordsList.innerHTML = `<div class="words-empty">${emptyText}</div>`;
    return;
  }

  wordsList.innerHTML = '';
  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'word-row';
    row.setAttribute('role', 'listitem');

    const main = document.createElement('div');
    main.className = 'word-row__main';

    const term = document.createElement('span');
    term.className = 'word-row__term';
    term.textContent = item.word || '';

    const translation = document.createElement('span');
    translation.className = 'word-row__translation';
    const translationText = String(item.translation || '').trim();
    translation.textContent = translationText || t('words.noTranslationLabel');
    if (!translationText) {
      translation.classList.add('word-row__translation--empty');
    }
    enableWordTranslationEditing(translation, item, row);
    translation.title = t('words.editTranslation');

    main.append(term, translation);

    const actions = document.createElement('div');
    actions.className = 'word-row__actions';

    const views = document.createElement('span');
    views.className = 'word-row__views';
    const viewCount = Number(item.view_count) || 0;
    views.textContent = `${viewCount}×`;

    const status = document.createElement('span');
    const statusLabel = formatStatus(item.status);
    const isKnown = statusLabel === 'K';
    status.className = `word-row__status${isKnown ? ' word-row__status--known' : ''}`;
    if (isKnown) {
      status.innerHTML = '<svg class="word-row__status-icon" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M9.2 16.6 4.8 12.2l1.4-1.4 3 3 8-8 1.4 1.4z"/></svg>';
    } else {
      status.textContent = statusLabel;
    }
    status.title = t('words.levelAria', { level: statusLabel });
    status.setAttribute('aria-label', t('words.levelAria', { level: statusLabel }));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'word-row__delete';
    remove.setAttribute('aria-label', t('words.deleteAria', { word: item.word || t('words.wordFallback') }));
    remove.title = t('words.delete');
    remove.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M6 2h4l.5 1H14v1.5H2V3h3.5L6 2zm1 3.5V12h1.5V5.5H7zm3 0V12h1.5V5.5H10zM3.5 4.5h9l-.7 9.2A1.5 1.5 0 0 1 10.3 15H5.7a1.5 1.5 0 0 1-1.5-1.3L3.5 4.5z"/></svg>';
    remove.addEventListener('click', () => {
      deleteWord(item, row, remove);
    });

    actions.append(views, status, remove);
    row.append(main, actions);
    fragment.appendChild(row);
  });
  wordsList.appendChild(fragment);
}

function enableWordTranslationEditing(element, item, row) {
  element.classList.add('word-row__translation--editable');
  element.title = t('words.editTranslation');
  element.setAttribute('role', 'button');
  element.tabIndex = 0;

  const startEdit = () => {
    if (row.classList.contains('word-row--editing') || row.classList.contains('word-row--deleting')) {
      return;
    }
    const current = String(item.translation || '').trim();
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'word-row__translation-input';
    input.value = current;
    input.setAttribute('aria-label', t('words.translationFor', { word: item.word || t('words.wordFallback') }));
    input.spellcheck = true;

    row.classList.add('word-row--editing');
    element.replaceWith(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = (save) => {
      if (finished) {
        return;
      }
      finished = true;
      const next = String(input.value || '').replace(/\s+/g, ' ').trim();
      if (!save || !next || next === current) {
        row.classList.remove('word-row--editing');
        input.replaceWith(element);
        element.textContent = current || t('words.noTranslationLabel');
        element.classList.toggle('word-row__translation--empty', !current);
        return;
      }
      saveWordTranslation(item, row, element, input, current, next);
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => {
      finish(true);
    });
  };

  element.addEventListener('click', startEdit);
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      startEdit();
    }
  });
}

function saveWordTranslation(item, row, element, input, previous, next) {
  input.disabled = true;
  row.classList.add('word-row--saving');

  chrome.runtime.sendMessage({
    type: 'UPDATE_TRANSLATION',
    cardId: item.lingq_card_id || null,
    word: item.word,
    translation: next,
  }, (response) => {
    row.classList.remove('word-row--saving', 'word-row--editing');
    if (chrome.runtime.lastError || !response?.ok) {
      input.disabled = false;
      input.replaceWith(element);
      element.textContent = previous || t('words.noTranslationLabel');
      element.classList.toggle('word-row__translation--empty', !previous);
      window.alert(response?.error || chrome.runtime.lastError?.message || t('words.saveTranslationFailed'));
      return;
    }

    const stored = String(response.translation || next).trim() || previous;
    item.translation = stored;
    if (response.cardId != null && response.cardId !== '') {
      item.lingq_card_id = response.cardId;
    }
    const needle = String(item.word || '').toLowerCase();
    const patch = (entry) => {
      if (String(entry.word || '').toLowerCase() !== needle) {
        return entry;
      }
      return {
        ...entry,
        translation: stored,
        lingq_card_id: item.lingq_card_id,
      };
    };
    wordsBucket = wordsBucket.map(patch);
    wordsCache.forEach((list, key) => {
      wordsCache.set(key, list.map(patch));
    });

    element.textContent = stored;
    element.classList.remove('word-row__translation--empty');
    input.replaceWith(element);
  });
}

function deleteWord(item, row, button) {
  const word = String(item?.word || '').trim();
  if (!word) {
    return;
  }
  if (!window.confirm(t('words.confirmDelete', { word }))) {
    return;
  }

  button.disabled = true;
  row.classList.add('word-row--deleting');

  chrome.runtime.sendMessage({
    type: 'DELETE_WORD',
    word,
    cardId: item.lingq_card_id || null,
  }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      button.disabled = false;
      row.classList.remove('word-row--deleting');
      window.alert(response?.error || chrome.runtime.lastError?.message || t('words.deleteFailed'));
      return;
    }

    if (!response.lingqDeleted || !response.dbDeleted) {
      button.disabled = false;
      row.classList.remove('word-row--deleting');
      window.alert(t('words.deletePartial'));
      return;
    }

    const needle = word.toLowerCase();
    const keep = (entry) => String(entry.word || '').toLowerCase() !== needle;
    wordsBucket = wordsBucket.filter(keep);
    wordsCache.forEach((list, key) => {
      wordsCache.set(key, list.filter(keep));
    });
    if (wordLetterFilter && wordLetterFilter !== 'TOP' && typeof wordsLetterCounts[wordLetterFilter] === 'number') {
      wordsLetterCounts[wordLetterFilter] = Math.max(0, wordsLetterCounts[wordLetterFilter] - 1);
      if (wordsLetterCounts[wordLetterFilter] === 0) {
        wordsEmptyLetters.add(wordLetterFilter);
      }
    }
    if (typeof wordsTotalInDb === 'number' && wordsTotalInDb > 0) {
      wordsTotalInDb -= 1;
    }
    renderWordLetters();
    renderWords();
  });
}

function formatStatus(status) {
  const value = Number(status);
  if (value === -1) {
    return 'I';
  }
  if (value === 5) {
    return 'K';
  }
  if (Number.isInteger(value) && value >= 1 && value <= 4) {
    return String(value);
  }
  return '1';
}

function loadStats(force) {
  if (!supabaseReady) {
    statsHeatmap.dataset.loaded = '';
    statsMeta.textContent = '';
    statsHeatmap.innerHTML = '';
    statsTableBody.innerHTML = '';
    applyDbGateUi();
    return;
  }
  if (statsLoading) {
    return;
  }
  const period = `calendar-${statsYear}`;
  if (!force && statsHeatmap.dataset.loaded === period) {
    return;
  }

  statsLoading = true;
  updateStatsYearControls();
  statsMeta.textContent = t('stats.loading');
  statsHeatmap.innerHTML = '';
  statsTableBody.innerHTML = '';

  chrome.runtime.sendMessage({ type: 'GET_USAGE_STATS', period }, (response) => {
    statsLoading = false;
    if (chrome.runtime.lastError || !response?.ok) {
      statsHeatmap.dataset.loaded = '';
      statsMeta.textContent = '';
      setEmptyMessage(statsHeatmap, response?.error || chrome.runtime.lastError?.message || t('stats.loadError'));
      return;
    }
    statsHeatmap.dataset.loaded = period;
    renderStats(response.stats || {});
  });
}

function loadLatency(force) {
  if (!supabaseReady) {
    latencyLoaded = false;
    latencyMeta.textContent = '';
    latencyChart.innerHTML = '';
    latencyTableBody.innerHTML = '';
    applyDbGateUi();
    return;
  }
  if (latencyLoading) {
    return;
  }
  if (!force && latencyLoaded) {
    return;
  }

  latencyLoading = true;
  latencyMeta.textContent = t('latency.loading');
  latencyChart.innerHTML = '';
  latencyTableBody.innerHTML = '';

  chrome.runtime.sendMessage({ type: 'GET_LATENCY_STATS' }, (response) => {
    latencyLoading = false;
    if (chrome.runtime.lastError || !response?.ok) {
      latencyLoaded = false;
      latencyMeta.textContent = '';
      setEmptyMessage(latencyChart, response?.error || chrome.runtime.lastError?.message || t('err.latencyLoad'), 'latency-chart__empty');
      return;
    }
    latencyLoaded = true;
    renderLatency(response.latency || {});
  });
}

function renderStats(stats) {
  const daysMap = new Map((stats.days || []).map((item) => {
    const raw = item?.day;
    const key = raw instanceof Date
      ? toDateKey(raw)
      : String(raw || '').slice(0, 10);
    return [key, Number(item.clicks) || 0];
  }).filter(([key]) => /^\d{4}-\d{2}-\d{2}$/.test(key)));
  const rangeStart = new Date(stats.rangeStart || stats.from);
  const rangeEnd = new Date(stats.rangeEnd || stats.to);
  const dayList = buildDayList(rangeStart, rangeEnd);
  const maxClicks = Math.max(0, ...dayList.map((day) => daysMap.get(day) || 0));
  const clicks = Number(stats.clicks) || 0;
  const activeDays = Number(stats.active_days) || 0;
  const avg = activeDays > 0 ? (clicks / activeDays) : 0;
  const top = dayList
    .map((day) => ({ day, clicks: daysMap.get(day) || 0 }))
    .sort((a, b) => b.clicks - a.clicks)[0];

  statsMeta.textContent = t('stats.clicks', {
    from: formatShortDate(rangeStart),
    to: formatShortDate(rangeEnd),
    n: formatKnownCount(clicks),
  });
  renderMonthCalendars(statsYear, rangeStart, rangeEnd, daysMap, maxClicks);

  const avgText = avg
    ? new Intl.NumberFormat(uiDateLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(avg)
    : '0';
  const topDayText = top && top.clicks
    ? t('stats.row.topDayValue', {
      date: formatShortDate(new Date(`${top.day}T12:00:00`)),
      n: formatKnownCount(top.clicks),
    })
    : '—';

  const rows = [
    [t('stats.row.clicksYear'), formatKnownCount(clicks)],
    [t('stats.row.phrases'), formatKnownCount(stats.phrases)],
    [t('stats.row.activeDays'), formatKnownCount(activeDays)],
    [t('stats.row.avgClicks'), avgText],
    [t('stats.row.topDay'), topDayText],
    [t('stats.row.added'), formatKnownCount(stats.added)],
    [t('stats.row.edited'), formatKnownCount(stats.edited)],
    [t('stats.row.totalWords'), formatKnownCount(stats.total_words)],
    [t('words.statusN', { n: 1 }), formatKnownCount(stats.status_1)],
    [t('words.statusN', { n: 2 }), formatKnownCount(stats.status_2)],
    [t('words.statusN', { n: 3 }), formatKnownCount(stats.status_3)],
    [t('words.statusN', { n: 4 }), formatKnownCount(stats.status_4)],
    [t('words.statusK'), formatKnownCount(stats.status_5)],
  ];

  fillStatsTable(statsTableBody, rows);
}

function setEmptyMessage(container, message, className = 'words-empty') {
  if (!container) {
    return;
  }
  container.replaceChildren();
  const el = document.createElement('div');
  el.className = className;
  el.textContent = String(message || '');
  container.append(el);
}

function renderLatency(latency) {
  if (latency.error) {
    latencyMeta.textContent = '';
    setEmptyMessage(latencyChart, latency.error, 'latency-chart__empty');
    latencyTableBody.innerHTML = '';
    return;
  }

  const weekStart = latency.week?.from ? new Date(latency.week.from) : null;
  const weekEnd = latency.week?.to ? new Date(latency.week.to) : null;
  const count = formatKnownCount(latency.count);
  latencyMeta.textContent = weekStart && weekEnd
    ? t('latency.meta', {
      from: formatShortDate(weekStart),
      to: formatShortDate(weekEnd),
      n: count,
    })
    : t('latency.metaCount', { n: count });

  fillStatsTable(latencyTableBody, latencyRows(latency));
  requestAnimationFrame(() => {
    renderLatencyWeekChart(latency.week);
  });
}

function fillStatsTable(body, rows) {
  body.innerHTML = '';
  rows.forEach(([label, value]) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = label;
    const td = document.createElement('td');
    td.textContent = value;
    tr.append(th, td);
    body.appendChild(tr);
  });
}

function updateStatsYearControls() {
  const maxYear = new Date().getFullYear();
  if (statsYearTitle) {
    statsYearTitle.textContent = String(statsYear);
  }
  if (statsYearNextButton) {
    statsYearNextButton.disabled = statsYear >= maxYear;
  }
}

function renderMonthCalendars(year, rangeStart, rangeEnd, daysMap, maxClicks) {
  statsHeatmap.innerHTML = '';
  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
    return;
  }

  const rangeStartKey = toDateKey(rangeStart);
  const rangeEndKey = toDateKey(rangeEnd);
  const months = Array.from({ length: 12 }, (_, month) => ({ year, month }));
  statsHeatmap.classList.add('heatmap--year');

  months.forEach(({ year: monthYear, month }) => {
    const card = document.createElement('section');
    card.className = 'month-card';

    const title = document.createElement('h3');
    title.className = 'month-card__title';
    title.textContent = new Intl.DateTimeFormat(uiDateLocale(), { month: 'long' }).format(new Date(monthYear, month, 1));
    card.appendChild(title);

    const weekdays = document.createElement('div');
    weekdays.className = 'month-card__weekdays';
    weekdayLabels().forEach((label, index) => {
      const mark = document.createElement('span');
      mark.textContent = label;
      if (index === 6) {
        mark.classList.add('is-sunday');
      }
      weekdays.appendChild(mark);
    });
    card.appendChild(weekdays);

    const grid = document.createElement('div');
    grid.className = 'month-card__grid';

    const firstDay = new Date(monthYear, month, 1);
    const daysInMonth = new Date(monthYear, month + 1, 0).getDate();
    const startPad = (firstDay.getDay() + 6) % 7;

    for (let i = 0; i < startPad; i += 1) {
      const pad = document.createElement('span');
      pad.className = 'heat heat-pad';
      grid.appendChild(pad);
    }

    for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber += 1) {
      const date = new Date(monthYear, month, dayNumber);
      const key = toDateKey(date);
      const inRange = key >= rangeStartKey && key <= rangeEndKey;
      const count = inRange ? (Number(daysMap.get(key)) || 0) : 0;
      const cell = document.createElement(inRange ? 'button' : 'span');

      if (inRange) {
        cell.type = 'button';
        cell.className = `heat heat-${heatLevel(count, maxClicks)}`;
        cell.title = t('stats.dayClicks', { date: formatShortDate(date), n: formatKnownCount(count) });
        cell.setAttribute('aria-label', cell.title);
      } else {
        cell.className = 'heat heat-out';
        cell.title = t('stats.outOfRange', { date: formatShortDate(date) });
      }

      if (date.getDay() === 0) {
        cell.classList.add('is-sunday');
      }

      grid.appendChild(cell);
    }

    card.appendChild(grid);
    statsHeatmap.appendChild(card);
  });
}

function buildDayList(start, end) {
  const days = [];
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return days;
  }
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor <= last) {
    days.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function heatLevel(count, maxClicks) {
  if (!count) {
    return 0;
  }
  if (!maxClicks || maxClicks <= 1) {
    return 1;
  }
  const ratio = count / maxClicks;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function formatShortDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat(uiDateLocale(), {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(date);
}

