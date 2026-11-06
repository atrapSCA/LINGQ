const DEFAULTS = {
  apiKey: 'd59c2650c569e8f6aba883b9d4fb48826d1b1d25',
  language: 'en',
  targetLanguage: 'cs',
  enabled: true,
  clickCount: 1,
  latencyIdleMinSeconds: 60,
  latencyIdleMaxSeconds: 80,
  chatgptApiKey: '',
  chatgptApiKeyValid: false,
  chatgptEnabled: true,
  chatgptModel: 'gpt-5-nano',
  alternativesSource: 'lingq',
  newWordTranslationSource: 'lingq',
  lingqEnabled: true,
  supabaseEnabled: true,
  supabaseUrl: '',
  supabaseKey: '',
};

const CHATGPT_MODEL_IDS = [
  'gpt-5-nano',
  'gpt-4o-mini',
  'gpt-5.4-nano',
  'gpt-5-mini',
  'gpt-4.1-mini',
];

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
const chatgptModelInput = document.getElementById('chatgpt-model');
const chatgptModelHelp = document.getElementById('chatgpt-model-help');
const languageInput = document.getElementById('language');
const targetLanguageInput = document.getElementById('target-language');
const supabaseEnabledInput = document.getElementById('supabase-enabled');
const supabaseSettingsBlock = document.getElementById('supabase-settings-block');
const supabaseUrlInput = document.getElementById('supabase-url');
const supabaseKeyInput = document.getElementById('supabase-key');
const clickCountInput = document.getElementById('click-count');
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
const syncKnownWordsButton = document.getElementById('sync-known-words');
const resetLingqImportButton = document.getElementById('reset-lingq-import');
const importKnownStatus = document.getElementById('import-known-status');
const importProgress = document.getElementById('import-progress');
const importProgressPhase = document.getElementById('import-progress-phase');
const importProgressNumbers = document.getElementById('import-progress-numbers');
const importProgressFill = document.getElementById('import-progress-fill');
const importProgressBar = document.getElementById('import-progress-bar');
const importProgressTotalLabel = document.getElementById('import-progress-total-label');
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
const WEEKDAY_LABELS = ['po', 'út', 'st', 'čt', 'pá', 'so', 'ne'];

let allWords = [];
let wordsLoaded = false;
let wordsLoading = false;
let statsLoading = false;
let latencyLoading = false;
let latencyLoaded = false;
let supabaseReady = false;
let supabaseGateMessage = 'Supabase není připravená.';
let supabaseSchemaNeedsUpdate = false;
const schemaAlert = document.getElementById('schema-alert');
const schemaAlertText = document.getElementById('schema-alert-text');
const schemaAlertOpenSettings = document.getElementById('schema-alert-open-settings');

chrome.runtime.sendMessage({ type: 'APP_OPENED' }, () => {
  void chrome.runtime.lastError;
});

applyBuildRoleUi();
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

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.knownWordsSync) {
    renderKnownWordsSyncProgress(changes.knownWordsSync.newValue || null);
  }
});

syncKnownWordsButton.addEventListener('click', () => {
  startKnownWordsSync();
});

resetLingqImportButton.addEventListener('click', () => {
  if (!window.confirm('Resetovat progress importu z LingQ? Už nahraná slovíčka v DB zůstanou.')) {
    return;
  }
  chrome.runtime.sendMessage({ type: 'RESET_LINGQ_IMPORT_PROGRESS' }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      setKnownWordsStatus(
        response?.error || chrome.runtime.lastError?.message || 'Progress se nepodařilo resetovat.',
        'error',
      );
      return;
    }
    renderKnownWordsSyncProgress(response.progress);
  });
});

chrome.storage.sync.get(DEFAULTS, (settings) => {
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
  const idleRange = normalizeIdleRange(settings);
  latencyIdleMinInput.value = String(idleRange.min);
  latencyIdleMaxInput.value = String(idleRange.max);
  renderClickHelp(clickCountInput.value);
  applyOptionalFeatureUi();
  updateLingqAvailability();
  updateChatgptDependentAvailability({
    alternativesSource: settings.alternativesSource === 'chatgpt' ? 'chatgpt' : 'lingq',
    newWordTranslationSource: settings.newWordTranslationSource === 'chatgpt' ? 'chatgpt' : 'lingq',
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
    formMessage.textContent = 'LingQ nelze vypnout bez připravené DB a platného ChatGPT klíče.';
  }
  const offlineOnly = !lingqEnabled;
  const alternativesSource = offlineOnly || (chatgptEnabled && valid && alternativesSourceInput.value === 'chatgpt')
    ? 'chatgpt'
    : 'lingq';
  const newWordTranslationSource = offlineOnly || (chatgptEnabled && valid && newWordSourceInput.value === 'chatgpt')
    ? 'chatgpt'
    : 'lingq';
  applyOptionalFeatureUi();
  updateLingqAvailability();
  updateChatgptDependentAvailability({ alternativesSource, newWordTranslationSource });
  chrome.storage.sync.set({
    apiKey: apiKeyInput.value.trim(),
    lingqEnabled,
    chatgptEnabled,
    chatgptApiKey,
    chatgptApiKeyValid: valid,
    chatgptModel: resolveChatgptModel(chatgptModelInput.value),
    alternativesSource,
    newWordTranslationSource,
    language: languageInput.value,
    targetLanguage: targetLanguageInput.value,
    supabaseEnabled,
    supabaseUrl: supabaseUrlInput.value.trim().replace(/\/$/, ''),
    supabaseKey: supabaseKeyInput.value.trim(),
    ...readIdleRange(),
  }, () => {
    const idleRange = readIdleRange();
    latencyIdleMinInput.value = String(idleRange.latencyIdleMinSeconds);
    latencyIdleMaxInput.value = String(idleRange.latencyIdleMaxSeconds);
    formMessage.textContent = 'Nastavení bylo uloženo.';
    wordsLoaded = false;
    latencyLoaded = false;
    refreshSupabaseGate({ force: true });
    window.setTimeout(() => { formMessage.textContent = ''; }, 2200);
  });
});

chatgptEnabledInput.addEventListener('change', () => {
  const chatgptEnabled = chatgptEnabledInput.checked;
  applyOptionalFeatureUi();
  if (!chatgptEnabled) {
    chatgptApiKeyValid = false;
    if (!lingqEnabledInput.checked) {
      lingqEnabledInput.checked = true;
      chrome.storage.sync.set({ lingqEnabled: true });
    }
    updateLingqAvailability();
    updateChatgptDependentAvailability({ alternativesSource: 'lingq', newWordTranslationSource: 'lingq' });
    chrome.storage.sync.set({
      chatgptEnabled: false,
      alternativesSource: 'lingq',
      newWordTranslationSource: 'lingq',
    });
    return;
  }
  chrome.storage.sync.set({ chatgptEnabled: true });
  updateLingqAvailability();
  if (chatgptApiKeyInput.value.trim()) {
    validateChatgptApiKey(chatgptApiKeyInput.value.trim());
  } else {
    updateChatgptDependentAvailability({ alternativesSource: 'lingq', newWordTranslationSource: 'lingq' });
  }
});

supabaseEnabledInput.addEventListener('change', () => {
  const supabaseEnabled = supabaseEnabledInput.checked;
  applyOptionalFeatureUi();
  if (!supabaseEnabled && !lingqEnabledInput.checked) {
    lingqEnabledInput.checked = true;
    chrome.storage.sync.set({ lingqEnabled: true });
  }
  chrome.storage.sync.set({ supabaseEnabled }, () => {
    wordsLoaded = false;
    latencyLoaded = false;
    refreshSupabaseGate({ force: true }).finally(() => updateLingqAvailability());
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
    });
    updateChatgptDependentAvailability({ alternativesSource: 'chatgpt', newWordTranslationSource: 'chatgpt' });
    return;
  }
  chrome.storage.sync.set({ lingqEnabled: true }, () => {
    if (lingqSyncStatus) {
      lingqSyncStatus.textContent = 'Spouštím synchronizaci DB → LingQ…';
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

chatgptModelInput.addEventListener('change', () => {
  if (!chatgptApiKeyValid) {
    updateChatgptDependentAvailability({ alternativesSource: 'lingq', newWordTranslationSource: 'lingq' });
    return;
  }
  const chatgptModel = resolveChatgptModel(chatgptModelInput.value);
  chatgptModelInput.value = chatgptModel;
  chrome.storage.sync.set({ chatgptModel });
});

chatgptApiKeyInput.addEventListener('change', () => {
  validateChatgptApiKey(chatgptApiKeyInput.value.trim()).then((valid) => {
    const alternativesSource = valid && alternativesSourceInput.value === 'chatgpt' ? 'chatgpt' : 'lingq';
    const newWordTranslationSource = valid && newWordSourceInput.value === 'chatgpt' ? 'chatgpt' : 'lingq';
    chrome.storage.sync.set({
      chatgptApiKey: chatgptApiKeyInput.value.trim(),
      chatgptApiKeyValid: valid,
      chatgptModel: resolveChatgptModel(chatgptModelInput.value),
      alternativesSource,
      newWordTranslationSource,
    });
  });
});

function setChatgptKeyStatus(message, tone = '') {
  chatgptKeyStatus.textContent = message;
  chatgptKeyStatus.dataset.tone = tone;
}

function resolveChatgptModel(model) {
  const value = String(model || '').trim();
  return CHATGPT_MODEL_IDS.includes(value) ? value : DEFAULTS.chatgptModel;
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
    reasons.push('zapněte Supabase DB');
  } else if (!supabaseReady) {
    reasons.push('ověřte / aktualizujte Supabase DB (musí být připravená)');
  }
  if (!chatgptEnabledInput.checked) {
    reasons.push('zapněte ChatGPT');
  } else if (!chatgptApiKeyInput.value.trim()) {
    reasons.push('vyplňte ChatGPT API klíč');
  } else if (!chatgptApiKeyValid) {
    reasons.push('ověřte platný ChatGPT API klíč');
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
    ? `LingQ nelze vypnout. Tato akce je možná jen když funguje Supabase DB a je vyplněný platný ChatGPT klíč. Chybí: ${reasons.join('; ')}.`
    : 'LingQ nelze vypnout. Tato akce je možná jen když funguje Supabase DB a je vyplněný platný ChatGPT klíč.';
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
      ? 'Bez LingQ doplněk ukládá slovíčka do Supabase a překládá přes ChatGPT. Po opětovném zapnutí se změny synchronizují do LingQ.'
      : 'LingQ lze vypnout pouze tehdy, když funguje Supabase DB a je vyplněný platný ChatGPT API klíč.';
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
    chatgptModelHelp.textContent = chatgptOn
      ? 'Model lze zvolit až po ověření ChatGPT API klíče. Ceny jsou za 1 milion tokenů (vstup / výstup).'
      : 'Zapněte ChatGPT a vyplňte platný klíč, pokud chcete volit model.';
    return;
  }

  newWordSourceChatgptOption.disabled = false;
  alternativesSourceChatgptOption.disabled = false;
  newWordSourceInput.disabled = !lingqOn;
  alternativesSourceInput.disabled = !lingqOn;

  if (!lingqOn) {
    newWordSourceInput.value = 'chatgpt';
    alternativesSourceInput.value = 'chatgpt';
    newWordSourceHelp.textContent = 'LingQ je vypnuté — nová slovíčka překládá ChatGPT do databáze.';
    alternativesSourceHelp.textContent = 'LingQ je vypnuté — další překlady jdou přes ChatGPT.';
    chatgptModelHelp.textContent = 'Ceny jsou za 1 milion tokenů (vstup / výstup) podle ceníku OpenAI.';
    return;
  }

  newWordSourceInput.value = preferredNewWord === 'chatgpt' ? 'chatgpt' : 'lingq';
  alternativesSourceInput.value = preferredAlternatives === 'chatgpt' ? 'chatgpt' : 'lingq';
  newWordSourceHelp.textContent = 'Slovíčka, která ještě nejsou v LingQ. Po překladu se karta v LingQ stejně založí.';
  alternativesSourceHelp.textContent = 'Zdroj sekce „Další překlady“ ve vyskakovací bublině. ChatGPT se volá až po kliknutí na tlačítko.';
  chatgptModelHelp.textContent = 'Ceny jsou za 1 milion tokenů (vstup / výstup) podle ceníku OpenAI. Výchozí je gpt-5-nano.';
}

function validateChatgptApiKey(apiKey, options = {}) {
  const key = String(apiKey || '').trim();
  const requestId = ++chatgptValidationRequest;
  if (!key) {
    chatgptApiKeyValid = false;
    if (!options.quiet) {
      setChatgptKeyStatus('Bez API klíče nelze použít ChatGPT pro překlady.', 'warn');
    }
    updateChatgptDependentAvailability({ alternativesSource: 'lingq', newWordTranslationSource: 'lingq' });
    return Promise.resolve(false);
  }

  if (!options.quiet) {
    setChatgptKeyStatus('Ověřuji ChatGPT API klíč…');
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'VALIDATE_CHATGPT_KEY', apiKey: key }, (response) => {
      if (requestId !== chatgptValidationRequest) {
        resolve(chatgptApiKeyValid);
        return;
      }
      if (chrome.runtime.lastError || !response?.ok) {
        chatgptApiKeyValid = false;
        setChatgptKeyStatus(response?.error || chrome.runtime.lastError?.message || 'ChatGPT API klíč se nepodařilo ověřit.', 'error');
        updateChatgptDependentAvailability({ alternativesSource: 'lingq', newWordTranslationSource: 'lingq' });
        updateLingqAvailability();
        resolve(false);
        return;
      }
      chatgptApiKeyValid = true;
      setChatgptKeyStatus('ChatGPT API klíč je platný.', 'ok');
      updateChatgptDependentAvailability({
        alternativesSource: alternativesSourceInput.value === 'chatgpt' ? 'chatgpt' : 'lingq',
        newWordTranslationSource: newWordSourceInput.value === 'chatgpt' ? 'chatgpt' : 'lingq',
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
  toggleKeyButton.textContent = showing ? 'Zobrazit' : 'Skrýt';
});

toggleChatgptKeyButton.addEventListener('click', () => {
  const showing = chatgptApiKeyInput.type === 'text';
  chatgptApiKeyInput.type = showing ? 'password' : 'text';
  toggleChatgptKeyButton.textContent = showing ? 'Zobrazit' : 'Skrýt';
});

toggleSupabaseKeyButton.addEventListener('click', () => {
  const showing = supabaseKeyInput.type === 'text';
  supabaseKeyInput.type = showing ? 'password' : 'text';
  toggleSupabaseKeyButton.textContent = showing ? 'Zobrazit' : 'Skrýt';
});

checkSupabaseDbButton.addEventListener('click', () => {
  runSupabaseDbCheck();
});

installSupabaseDbButton.addEventListener('click', () => {
  runSupabaseDbInstall();
});

wordSearchInput.addEventListener('input', () => {
  renderWords();
});

wordStatusFilterInput.addEventListener('change', () => {
  renderWords();
});

wordSortInput.addEventListener('change', () => {
  renderWords();
});

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
  [panelWords, panelImport, panelStats, panelLatency].forEach((panel) => {
    if (!panel) {
      return;
    }
    panel.classList.toggle('is-db-locked', !supabaseReady);
    panel.querySelectorAll('[data-db-gate]').forEach((gate) => {
      gate.hidden = supabaseReady;
    });
  });
  if (syncKnownWordsButton) {
    syncKnownWordsButton.disabled = !supabaseReady;
  }
  if (resetLingqImportButton) {
    resetLingqImportButton.disabled = !supabaseReady;
  }
}

function refreshSupabaseGate({ force = false } = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_SUPABASE_STATUS', force }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        supabaseReady = false;
        supabaseSchemaNeedsUpdate = false;
        supabaseGateMessage = response?.error
          || chrome.runtime.lastError?.message
          || 'Supabase není připravená.';
        applySchemaUpdateAlert({});
      } else {
        supabaseReady = response.ready === true;
        supabaseGateMessage = response.message || (supabaseReady
          ? 'Databáze je připravená.'
          : 'Supabase není připravená.');
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
  const installed = response.installedVersion || 'neznámá / chybí';
  if (schemaAlertText) {
    if (response.structureOk === false) {
      schemaAlertText.textContent = `Databáze neodpovídá aktuálnímu doplňku (očekávané schéma v${expected}). `
        + 'Bez aktualizace databáze nebude doplněk řádně fungovat. '
        + 'Otevřete Nastavení → Supabase DB → Nainstalovat / aktualizovat databázi.';
    } else {
      schemaAlertText.textContent = `Doplněk očekává schéma v${expected}, v databázi je ${installed}. `
        + 'Bez aktualizace databáze nebude doplněk řádně fungovat. '
        + 'Otevřete Nastavení → Supabase DB → Nainstalovat / aktualizovat databázi.';
    }
  }
  schemaAlert.hidden = false;
}

schemaAlertOpenSettings?.addEventListener('click', () => {
  activateTab('settings');
  const supabaseSection = document.getElementById('settings-supabase-title');
  supabaseSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    return [['Odezva LingQ', latency.error]];
  }
  const sourceLabel = {
    click: 'kliknutí',
    idle: 'nečinnost',
    probe: 'nečinnost',
    phrase: 'věta',
  };
  const last = latency.lastMs == null
    ? '—'
    : `${formatDuration(latency.lastMs)} · ${sourceLabel[latency.lastSource] || 'měření'}${latency.lastOk === false ? ' · chyba' : ''}`;
  const statusRows = [
    ['new', 'nové slovíčko'],
    ['1', 'znalost 1'],
    ['2', 'znalost 2'],
    ['3', 'znalost 3'],
    ['4', 'znalost 4'],
    ['K', 'znalost K'],
  ].map(([key, label]) => {
    const item = latency.byStatus?.[key];
    if (!item?.count) {
      return [`Odezva · ${label}`, '—'];
    }
    return [`Odezva · ${label}`, `${formatDuration(item.avgMs)} (${item.count}×)`];
  });
  return [
    ['Průměrná odezva LingQ', formatDuration(latency.avgMs)],
    ['Odezva po kliknutí', latency.clickCount ? `${formatDuration(latency.clickAvgMs)} (${latency.clickCount}×)` : '—'],
    ['Odezva kontrolního dotazu', latency.probeCount ? `${formatDuration(latency.probeAvgMs)} (${latency.probeCount}×)` : '—'],
    ['Odezva překladu věty', latency.phraseCount ? `${formatDuration(latency.phraseAvgMs)} (${latency.phraseCount}×)` : '—'],
    ...statusRows,
    ['Poslední odezva', last],
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
    latencyChart.innerHTML = '<div class="latency-chart__empty">Zatím žádná měření odezvy za posledních 7 dní.</div>';
    return;
  }

  const width = 600;
  const height = 168;
  const pad = { top: 12, right: 12, bottom: 28, left: 52 };
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

  latencyChart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Hodinový průměr odezvy LingQ">
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
  return new Intl.DateTimeFormat('cs-CZ', { weekday: 'short', day: 'numeric' }).format(date);
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
    ? 'Bublina se otevře po dvou kliknutích myší na slovo.'
    : 'Bublina se otevře po jednom kliknutí myši na slovo. U odkazů je potřeba dvojité kliknutí, aby se stránka neotevřela.';
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
  return new Promise((resolve) => {
    chrome.storage.sync.set(settings, () => resolve(settings));
  });
}

async function runSupabaseDbCheck() {
  checkSupabaseDbButton.disabled = true;
  installSupabaseDbButton.disabled = true;
  setSupabaseDbStatus('Kontroluji databázi…');
  try {
    const settings = await persistSupabaseFormSettings();
    chrome.runtime.sendMessage({ type: 'CHECK_SUPABASE_SCHEMA', settings }, (response) => {
      checkSupabaseDbButton.disabled = false;
      installSupabaseDbButton.disabled = false;
      if (chrome.runtime.lastError || !response?.ok) {
        setSupabaseDbStatus(
          response?.error || chrome.runtime.lastError?.message || 'Kontrola databáze se nezdařila.',
          'error',
        );
        return;
      }
      const tone = response.ready ? 'ok' : (response.structureOk ? 'warn' : 'error');
      setSupabaseDbStatus(response.message, tone);
      supabaseReady = response.ready === true;
      supabaseGateMessage = response.message || supabaseGateMessage;
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
        wordsLoaded = false;
        latencyLoaded = false;
      }
    });
  } catch (error) {
    checkSupabaseDbButton.disabled = false;
    installSupabaseDbButton.disabled = false;
    setSupabaseDbStatus(error instanceof Error ? error.message : 'Kontrola databáze se nezdařila.', 'error');
  }
}

async function runSupabaseDbInstall() {
  checkSupabaseDbButton.disabled = true;
  installSupabaseDbButton.disabled = true;
  setSupabaseDbStatus('Připravuji instalaci…');
  try {
    const settings = await persistSupabaseFormSettings();
    chrome.runtime.sendMessage({ type: 'PREPARE_SUPABASE_INSTALL', settings }, async (response) => {
      checkSupabaseDbButton.disabled = false;
      installSupabaseDbButton.disabled = false;
      if (chrome.runtime.lastError || !response?.ok) {
        setSupabaseDbStatus(
          response?.error || chrome.runtime.lastError?.message || 'Instalace se nezdařila.',
          'error',
        );
        return;
      }

      if (response.ready) {
        setSupabaseDbStatus(response.message || 'Databáze už je aktuální.', 'ok');
        supabaseReady = true;
        supabaseSchemaNeedsUpdate = false;
        supabaseGateMessage = response.message || supabaseGateMessage;
        applySchemaUpdateAlert({});
        applyDbGateUi();
        updateLingqAvailability();
        wordsLoaded = false;
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
        setSupabaseDbStatus(
          'SQL se nepodařilo zkopírovat do schránky. Otevřete SQL Editor a soubory spusťte ručně ze složky supabase/.',
          'error',
        );
        if (response.editorUrl) {
          window.open(response.editorUrl, '_blank', 'noopener,noreferrer');
        }
        return;
      }

      if (response.editorUrl) {
        window.open(response.editorUrl, '_blank', 'noopener,noreferrer');
      }
      setSupabaseDbStatus(
        `${response.message} SQL (${response.fileCount} souborů) je ve schránce — v SQL Editoru vložte (Ctrl+V) a spusťte Run. Pak klikněte na Zkontrolovat databázi.`,
        'warn',
      );
    });
  } catch (error) {
    checkSupabaseDbButton.disabled = false;
    installSupabaseDbButton.disabled = false;
    setSupabaseDbStatus(error instanceof Error ? error.message : 'Instalace se nezdařila.', 'error');
  }
}

function formatKnownCount(value) {
  return new Intl.NumberFormat('cs-CZ').format(Number(value) || 0);
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

function clearImportCooldownTimer() {
  if (importCooldownTimer) {
    window.clearInterval(importCooldownTimer);
    importCooldownTimer = null;
  }
}

function updateImportProgressUi(progress) {
  if (!progress) {
    importProgress.hidden = true;
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
    ? 'Právě: known words'
    : (progress.phase === 'done' ? 'Hotovo (karty + known words)' : 'Právě: Vocabulary karty');
  const imported = Number(progress.axisImported) || 0;
  const total = Number(progress.axisTotal) || 0;
  const percent = Number(progress.axisPercent) || 0;
  importProgressPhase.textContent = phaseLabel;
  importProgressNumbers.textContent = `${formatKnownCount(imported)} / ${formatKnownCount(total)}`;
  importProgressTotalLabel.textContent = formatKnownCount(total);
  importProgressFill.style.width = `${percent}%`;
  importProgressBar.setAttribute('aria-valuenow', String(percent));
}

function renderKnownWordsSyncProgress(progress) {
  clearImportCooldownTimer();
  if (!progress) {
    syncKnownWordsButton.disabled = false;
    syncKnownWordsButton.textContent = 'Importovat dalších 5 000';
    resetLingqImportButton.disabled = false;
    updateImportProgressUi(null);
    return;
  }

  updateImportProgressUi(progress);
  resetLingqImportButton.disabled = Boolean(progress.running);

  if (progress.running) {
    syncKnownWordsButton.disabled = true;
    syncKnownWordsButton.textContent = 'Import probíhá…';
    setKnownWordsStatus(progress.message || 'Pracuji…');
    return;
  }

  if (progress.phase === 'done') {
    syncKnownWordsButton.disabled = true;
    syncKnownWordsButton.textContent = 'Import dokončen';
    setKnownWordsStatus(
      progress.message
        || `Hotovo. Nová celkem ${formatKnownCount(progress.insertedTotal)}, aktualizovaná ${formatKnownCount(progress.updatedTotal)}.`,
      'ok',
    );
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
      syncKnownWordsButton.textContent = `Další dávka za ${formatCooldown(left)}`;
      setKnownWordsStatus(
        `${progress.message || 'Dávka uložena.'} Pro ochranu LingQ API počkejte na další import.`,
        'ok',
      );
    };
    tick();
    importCooldownTimer = window.setInterval(tick, 1000);
    return;
  }

  syncKnownWordsButton.disabled = false;
  const batch = Number(progress.batchSize) || 5000;
  syncKnownWordsButton.textContent = `Importovat dalších ${formatKnownCount(batch)}`;
  if (progress.error) {
    setKnownWordsStatus(progress.error, 'error');
  } else if (progress.message) {
    setKnownWordsStatus(progress.message, 'ok');
  } else {
    setKnownWordsStatus('Připraveno ke stažení další dávky z LingQ.');
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
  syncKnownWordsButton.textContent = 'Import probíhá…';
  setKnownWordsStatus('Spouštím další dávku z LingQ…');
  chrome.runtime.sendMessage({ type: 'SYNC_KNOWN_WORDS' }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      setKnownWordsStatus(
        response?.error || chrome.runtime.lastError?.message || 'Import z LingQ se nezdařil.',
        'error',
      );
      restoreKnownWordsSyncStatus();
      return;
    }
    renderKnownWordsSyncProgress(response);
    wordsLoaded = false;
    loadWords(true);
  });
}

function loadWords(force) {
  if (!supabaseReady) {
    wordsLoaded = false;
    allWords = [];
    wordsMeta.textContent = '';
    wordsList.innerHTML = '';
    applyDbGateUi();
    return;
  }
  if (wordsLoading) {
    return;
  }
  if (wordsLoaded && !force) {
    renderWords();
    return;
  }

  wordsLoading = true;
  wordsMeta.textContent = 'Načítám slovíčka…';
  wordsList.innerHTML = '';

  chrome.runtime.sendMessage({ type: 'LIST_SUPABASE_WORDS' }, (response) => {
    wordsLoading = false;
    if (chrome.runtime.lastError || !response?.ok) {
      wordsLoaded = false;
      allWords = [];
      wordsMeta.textContent = '';
      wordsList.innerHTML = `<div class="words-empty">${response?.error || chrome.runtime.lastError?.message || 'Slovník se nepodařilo načíst.'}</div>`;
      return;
    }

    wordsLoaded = true;
    allWords = Array.isArray(response.words) ? response.words : [];
    renderWords();
  });
}

function renderWords() {
  const query = wordSearchInput.value.trim().toLowerCase();
  const statusFilter = wordStatusFilterInput.value;
  const sort = wordSortInput.value;
  let items = allWords.filter((item) => String(item.translation || '').trim());
  const totalWithTranslation = items.length;

  if (statusFilter !== 'all') {
    const wanted = Number(statusFilter);
    items = items.filter((item) => Number(item.status) === wanted);
  }

  if (query) {
    items = items.filter((item) => {
      const word = String(item.word || '').toLowerCase();
      const translation = String(item.translation || '').toLowerCase();
      return word.includes(query) || translation.includes(query);
    });
  }

  items.sort((left, right) => {
    const leftWord = String(left.word || '');
    const rightWord = String(right.word || '');
    const leftViews = Number(left.view_count) || 0;
    const rightViews = Number(right.view_count) || 0;
    if (sort === 'alpha-desc') {
      return rightWord.localeCompare(leftWord, 'cs', { sensitivity: 'base' });
    }
    if (sort === 'views-desc') {
      return rightViews - leftViews || leftWord.localeCompare(rightWord, 'cs', { sensitivity: 'base' });
    }
    if (sort === 'views-asc') {
      return leftViews - rightViews || leftWord.localeCompare(rightWord, 'cs', { sensitivity: 'base' });
    }
    return leftWord.localeCompare(rightWord, 'cs', { sensitivity: 'base' });
  });

  if (allWords.length === 0) {
    wordsMeta.textContent = 'V databázi zatím nejsou žádná slovíčka.';
    wordsList.innerHTML = '<div class="words-empty">Klikni na slovo na stránce — uloží se sem.</div>';
    return;
  }

  if (totalWithTranslation === 0) {
    wordsMeta.textContent = 'Žádná slovíčka s překladem.';
    wordsList.innerHTML = '<div class="words-empty">Slova bez překladu se ve slovníku nezobrazují.</div>';
    return;
  }

  const filtered = query || statusFilter !== 'all';
  wordsMeta.textContent = filtered
    ? `Zobrazeno ${items.length} z ${totalWithTranslation}`
    : `${totalWithTranslation} slovíček`;

  if (items.length === 0) {
    wordsList.innerHTML = '<div class="words-empty">Nic neodpovídá filtru.</div>';
    return;
  }

  wordsList.innerHTML = '';
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
    translation.textContent = translationText || 'Bez překladu';
    if (!translationText) {
      translation.classList.add('word-row__translation--empty');
    } else {
      enableWordTranslationEditing(translation, item, row);
    }

    main.append(term, translation);

    const actions = document.createElement('div');
    actions.className = 'word-row__actions';

    const views = document.createElement('span');
    views.className = 'word-row__views';
    const viewCount = Number(item.view_count) || 0;
    views.textContent = `${viewCount}×`;

    const status = document.createElement('span');
    const statusLabel = formatStatus(item.status);
    status.className = `word-row__status${statusLabel === 'K' ? ' word-row__status--known' : ''}`;
    status.textContent = statusLabel;
    status.title = `Úroveň znalosti ${statusLabel}`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'word-row__delete';
    remove.setAttribute('aria-label', `Odstranit ${item.word || 'slovíčko'}`);
    remove.title = 'Odstranit z LingQ i databáze';
    remove.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M6 2h4l.5 1H14v1.5H2V3h3.5L6 2zm1 3.5V12h1.5V5.5H7zm3 0V12h1.5V5.5H10zM3.5 4.5h9l-.7 9.2A1.5 1.5 0 0 1 10.3 15H5.7a1.5 1.5 0 0 1-1.5-1.3L3.5 4.5z"/></svg>';
    remove.addEventListener('click', () => {
      deleteWord(item, row, remove);
    });

    actions.append(views, status, remove);
    row.append(main, actions);
    wordsList.appendChild(row);
  });
}

function enableWordTranslationEditing(element, item, row) {
  element.classList.add('word-row__translation--editable');
  element.title = 'Kliknutím upravíte překlad';
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
    input.setAttribute('aria-label', `Překlad pro ${item.word || 'slovíčko'}`);
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
        element.textContent = current;
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
      element.textContent = previous;
      window.alert(response?.error || chrome.runtime.lastError?.message || 'Překlad se nepodařilo uložit.');
      return;
    }

    const stored = String(response.translation || next).trim() || previous;
    item.translation = stored;
    if (response.cardId != null && response.cardId !== '') {
      item.lingq_card_id = response.cardId;
    }
    const needle = String(item.word || '').toLowerCase();
    allWords = allWords.map((entry) => {
      if (String(entry.word || '').toLowerCase() !== needle) {
        return entry;
      }
      return {
        ...entry,
        translation: stored,
        lingq_card_id: item.lingq_card_id,
      };
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
  if (!window.confirm(`Odstranit „${word}“ z LingQ i z databáze?`)) {
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
      window.alert(response?.error || chrome.runtime.lastError?.message || 'Slovíčko se nepodařilo odstranit.');
      return;
    }

    if (!response.lingqDeleted || !response.dbDeleted) {
      button.disabled = false;
      row.classList.remove('word-row--deleting');
      window.alert('Slovíčko se nepodařilo úplně odstranit z LingQ i databáze.');
      return;
    }

    const needle = word.toLowerCase();
    allWords = allWords.filter((entry) => String(entry.word || '').toLowerCase() !== needle);
    renderWords();
  });
}

function formatStatus(status) {
  const value = Number(status);
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
  statsMeta.textContent = 'Načítám statistiky…';
  statsHeatmap.innerHTML = '';
  statsTableBody.innerHTML = '';

  chrome.runtime.sendMessage({ type: 'GET_USAGE_STATS', period }, (response) => {
    statsLoading = false;
    if (chrome.runtime.lastError || !response?.ok) {
      statsHeatmap.dataset.loaded = '';
      statsMeta.textContent = '';
      statsHeatmap.innerHTML = `<div class="words-empty">${response?.error || chrome.runtime.lastError?.message || 'Statistiky se nepodařilo načíst.'}</div>`;
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
  latencyMeta.textContent = 'Načítám odezvu…';
  latencyChart.innerHTML = '';
  latencyTableBody.innerHTML = '';

  chrome.runtime.sendMessage({ type: 'GET_LATENCY_STATS' }, (response) => {
    latencyLoading = false;
    if (chrome.runtime.lastError || !response?.ok) {
      latencyLoaded = false;
      latencyMeta.textContent = '';
      latencyChart.innerHTML = `<div class="latency-chart__empty">${response?.error || chrome.runtime.lastError?.message || 'Odezvu se nepodařilo načíst.'}</div>`;
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

  statsMeta.textContent = `${formatShortDate(rangeStart)} – ${formatShortDate(rangeEnd)} · ${clicks} kliknutí`;
  renderMonthCalendars(statsYear, rangeStart, rangeEnd, daysMap, maxClicks);

  const rows = [
    ['Kliknutí v roce', String(clicks)],
    ['Překlady vět', String(Number(stats.phrases) || 0)],
    ['Aktivní dny', String(activeDays)],
    ['Průměr kliknutí / aktivní den', avg ? avg.toFixed(1).replace('.', ',') : '0'],
    ['Nejaktivnější den', top && top.clicks ? `${formatShortDate(new Date(`${top.day}T12:00:00`))} (${top.clicks}×)` : '—'],
    ['Přidáno slovíček', String(Number(stats.added) || 0)],
    ['Upraveno slovíček', String(Number(stats.edited) || 0)],
    ['Celkem slovíček ve slovníku', String(Number(stats.total_words) || 0)],
    ['Znalost 1', String(Number(stats.status_1) || 0)],
    ['Znalost 2', String(Number(stats.status_2) || 0)],
    ['Znalost 3', String(Number(stats.status_3) || 0)],
    ['Znalost 4', String(Number(stats.status_4) || 0)],
    ['Znalost K', String(Number(stats.status_5) || 0)],
  ];

  fillStatsTable(statsTableBody, rows);
}

function renderLatency(latency) {
  if (latency.error) {
    latencyMeta.textContent = '';
    latencyChart.innerHTML = `<div class="latency-chart__empty">${latency.error}</div>`;
    latencyTableBody.innerHTML = '';
    return;
  }

  const weekStart = latency.week?.from ? new Date(latency.week.from) : null;
  const weekEnd = latency.week?.to ? new Date(latency.week.to) : null;
  latencyMeta.textContent = weekStart && weekEnd
    ? `${formatShortDate(weekStart)} – ${formatShortDate(weekEnd)} · ${Number(latency.count) || 0} měření`
    : `${Number(latency.count) || 0} měření`;

  renderLatencyWeekChart(latency.week);
  fillStatsTable(latencyTableBody, latencyRows(latency));
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
    title.textContent = new Intl.DateTimeFormat('cs-CZ', { month: 'long' }).format(new Date(monthYear, month, 1));
    card.appendChild(title);

    const weekdays = document.createElement('div');
    weekdays.className = 'month-card__weekdays';
    WEEKDAY_LABELS.forEach((label, index) => {
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
        cell.title = `${formatShortDate(date)}: ${count}×`;
        cell.setAttribute('aria-label', cell.title);
      } else {
        cell.className = 'heat heat-out';
        cell.title = `${formatShortDate(date)} (mimo období)`;
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
  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(date);
}

