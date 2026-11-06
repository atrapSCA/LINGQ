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
  chatgptModel: 'gpt-5-nano',
  alternativesSource: 'lingq',
  newWordTranslationSource: 'lingq',
  supabaseUrl: '',
  supabaseKey: '',
};

const CHATGPT_MODELS = {
  'gpt-5-nano': { inputPerMillion: 0.05, outputPerMillion: 0.40 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  'gpt-5.4-nano': { inputPerMillion: 0.20, outputPerMillion: 1.25 },
  'gpt-5-mini': { inputPerMillion: 0.25, outputPerMillion: 2.00 },
  'gpt-4.1-mini': { inputPerMillion: 0.40, outputPerMillion: 1.60 },
};

function resolveChatgptModel(settings) {
  const model = String(settings?.chatgptModel || '').trim();
  return Object.prototype.hasOwnProperty.call(CHATGPT_MODELS, model) ? model : DEFAULTS.chatgptModel;
}

const LATENCY_ALARM = 'lingq-latency-watch';
const PROBE_FALLBACK_WORD = 'the';
const PROBE_LANGUAGE = 'en';
let activeUserLookups = 0;

function iconPaths(enabled) {
  const state = enabled ? 'on' : 'off';
  return {
    16: `icons/${state}-16.png`,
    32: `icons/${state}-32.png`,
    48: `icons/${state}-48.png`,
    128: `icons/${state}-128.png`,
  };
}

function applyActionIcon(enabled) {
  const isEnabled = enabled !== false;
  chrome.action.setIcon({ path: iconPaths(isEnabled) });
  chrome.action.setTitle({
    title: isEnabled ? 'LingQ Click Translator — zapnuto' : 'LingQ Click Translator — vypnuto',
  });
}

function syncActionIcon() {
  chrome.storage.sync.get(DEFAULTS, (settings) => {
    applyActionIcon(settings.enabled);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULTS, (settings) => {
    chrome.storage.sync.set(settings);
    applyActionIcon(settings.enabled);
    ensureLatencyWatch();
  });
});

chrome.runtime.onStartup.addListener(() => {
  syncActionIcon();
  ensureLatencyWatch();
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') {
    return;
  }
  if (changes.enabled) {
    applyActionIcon(changes.enabled.newValue);
  }
  if (changes.supabaseUrl || changes.supabaseKey) {
    invalidateSupabaseReadyCache();
    ensureLatencyWatch({ reshuffle: true });
  }
  if (changes.latencyIdleMinSeconds || changes.latencyIdleMaxSeconds || changes.enabled) {
    ensureLatencyWatch({ reshuffle: true });
  }
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LATENCY_ALARM) {
    onLatencyAlarm();
  }
});
syncActionIcon();
ensureLatencyWatch();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'LOOKUP_WORD') {
    noteUserActivity();
    activeUserLookups += 1;
    const startedAt = Number(message.clickedAt) || Date.now();
    lookupWord(message.word)
      .then((result) => {
        sendResponse({ ok: true, ...result });
        recordLatency({
          source: 'click',
          word: result.word || message.word,
          wordStatus: latencyWordStatus(result),
          durationMs: Date.now() - startedAt,
          ok: true,
        });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: getErrorMessage(error) });
        recordLatency({
          source: 'click',
          word: message.word,
          durationMs: Date.now() - startedAt,
          ok: false,
          error: getErrorMessage(error),
        });
      })
      .finally(() => {
        activeUserLookups = Math.max(0, activeUserLookups - 1);
      });
    return true;
  }

  if (message.type === 'NOTE_ACTIVITY') {
    noteUserActivity();
    return false;
  }

  if (message.type === 'UPDATE_STATUS') {
    noteUserActivity();
    updateStatus(message.cardId, message.status, message.word, message.translation)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === 'UPDATE_TRANSLATION') {
    noteUserActivity();
    updateTranslation(message.cardId, message.word, message.translation)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === 'VALIDATE_CHATGPT_KEY') {
    validateChatgptApiKey(message.apiKey)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'ChatGPT API klíč se nepodařilo ověřit.' }));
    return true;
  }

  if (message.type === 'GET_ALTERNATIVES') {
    noteUserActivity();
    getAlternativeTranslations(message.word, message.currentTranslation)
      .then((translations) => reply(sendResponse, { ok: true, translations }))
      .catch((error) => reply(sendResponse, { ok: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === 'TRANSLATE_PHRASE') {
    noteUserActivity();
    const startedAt = Number(message.clickedAt) || Date.now();
    translatePhrase(message.text)
      .then((result) => {
        sendResponse({ ok: true, ...result });
        recordLatency({
          source: 'phrase',
          word: result.sentence || message.text,
          durationMs: Date.now() - startedAt,
          ok: true,
        });
        logUsageEvent('phrase', { word: result.sentence || message.text });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: getErrorMessage(error) });
        recordLatency({
          source: 'phrase',
          word: message.text,
          durationMs: Date.now() - startedAt,
          ok: false,
          error: getErrorMessage(error),
        });
      });
    return true;
  }

  if (message.type === 'GET_SUPABASE_STATUS') {
    getSupabaseGate({ force: Boolean(message.force) })
      .then((gate) => sendResponse({ ok: true, ...gate }))
      .catch((error) => sendResponse({
        ok: false,
        ready: false,
        configured: false,
        error: error instanceof Error ? error.message : 'Stav databáze se nepodařilo zjistit.',
      }));
    return true;
  }

  if (message.type === 'LIST_SUPABASE_WORDS') {
    requireSupabaseReady()
      .then(() => listSupabaseWords())
      .then((words) => sendResponse({ ok: true, words }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Slovník se nepodařilo načíst.' }));
    return true;
  }

  if (message.type === 'CHECK_SUPABASE_SCHEMA') {
    checkSupabaseSchema(message.settings || null)
      .then((result) => {
        rememberSupabaseReady(result.ready === true, message.settings || null);
        ensureLatencyWatch({ reshuffle: true });
        return result;
      })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        rememberSupabaseReady(false, message.settings || null);
        ensureLatencyWatch({ reshuffle: true });
        sendResponse({
          ok: false,
          ready: false,
          error: error instanceof Error ? error.message : 'Kontrola databáze se nezdařila.',
        });
      });
    return true;
  }

  if (message.type === 'PREPARE_SUPABASE_INSTALL') {
    prepareSupabaseInstall(message.settings || null)
      .then((result) => {
        rememberSupabaseReady(result.ready === true, message.settings || null);
        return result;
      })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Příprava instalace databáze se nezdařila.',
      }));
    return true;
  }

  if (message.type === 'DELETE_WORD') {
    noteUserActivity();
    requireSupabaseReady()
      .then(() => deleteWordEverywhere(message.word, message.cardId))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Slovíčko se nepodařilo odstranit.',
      }));
    return true;
  }

  if (message.type === 'SYNC_KNOWN_WORDS') {
    noteUserActivity();
    requireSupabaseReady()
      .then(() => syncKnownWordsToSupabase())
      .then((result) => reply(sendResponse, { ok: true, ...result }))
      .catch((error) => reply(sendResponse, {
        ok: false,
        error: error instanceof Error ? error.message : 'Import slovíček z LingQ se nezdařil.',
      }));
    return true;
  }

  if (message.type === 'GET_KNOWN_WORDS_SYNC_STATUS') {
    requireSupabaseReady()
      .then(() => chrome.storage.sync.get(DEFAULTS))
      .then((settings) => ensureImportProgress(settings, { forceRefreshTotals: Boolean(message.refreshTotals) }))
      .then((progress) => reply(sendResponse, { ok: true, progress }))
      .catch(async (error) => {
        const fallback = await readImportProgress();
        reply(sendResponse, {
          ok: false,
          progress: fallback,
          error: error instanceof Error ? error.message : 'Stav importu se nepodařilo obnovit.',
        });
      });
    return true;
  }

  if (message.type === 'RESET_LINGQ_IMPORT_PROGRESS') {
    requireSupabaseReady()
      .then(() => chrome.storage.sync.get(DEFAULTS))
      .then(async (settings) => {
        const fresh = enrichImportProgress(defaultImportProgress(settings.language || 'en'));
        await chrome.storage.local.set({ [KNOWN_WORDS_SYNC_KEY]: fresh });
        const progress = await ensureImportProgress(settings, { forceRefreshTotals: true });
        reply(sendResponse, { ok: true, progress });
      })
      .catch((error) => reply(sendResponse, {
        ok: false,
        error: error instanceof Error ? error.message : 'Progress se nepodařilo resetovat.',
      }));
    return true;
  }

  if (message.type === 'GET_USAGE_STATS') {
    requireSupabaseReady()
      .then(() => getUsageStats(message.period))
      .then((stats) => sendResponse({ ok: true, stats }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Statistiky se nepodařilo načíst.' }));
    return true;
  }

  if (message.type === 'GET_LATENCY_STATS') {
    requireSupabaseReady()
      .then(() => getLatencyStats())
      .then((latency) => sendResponse({ ok: true, latency }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Odezvu se nepodařilo načíst.' }));
    return true;
  }

  return false;
});

async function lookupWord(word, options = {}) {
  const probe = options.probe === true;
  const settings = await chrome.storage.sync.get(DEFAULTS);
  if (!settings.apiKey) {
    throw new Error('Nejdříve zadejte LingQ API klíč v nastavení doplňku.');
  }
  if (probe) {
    settings.language = PROBE_LANGUAGE;
  }

  const cleanWord = normalizeWord(word);
  const card = await findCard(cleanWord, settings);
  const cardStatus = card ? normalizeStatus(card.status, card.extended_status) : 0;

  let result;
  if (card && cardStatus > 1) {
    result = await attachMeanings(cardResult(cleanWord, card, settings), cleanWord, settings);
  } else if (await isKnownWord(cleanWord, settings)) {
    const hint = card ? null : await findHint(cleanWord, settings).catch(() => null);
    const translations = extractTranslations(card?.hints || hint, settings.targetLanguage);
    let cardId = card?.pk ?? card?.id ?? null;
    if (cardId && !probe) {
      try {
        const updated = await updateStatus(cardId, 5, cleanWord);
        cardId = updated.cardId ?? cardId;
      } catch {
        // V bublině zůstane K, i když se stav karty nepodaří hned srovnat.
      }
    }
    rememberKnownWord(cleanWord, settings);
    result = await attachMeanings({
      word: cleanWord,
      translation: translations[0] || 'Překlad není k dispozici.',
      translations,
      status: 5,
      cardId,
      created: false,
      unknown: false,
    }, cleanWord, settings);
  } else if (card) {
    result = await attachMeanings(cardResult(cleanWord, card, settings), cleanWord, settings);
  } else if (probe) {
    const hint = await findHint(cleanWord, settings).catch(() => null);
    const translations = extractTranslations(hint, settings.targetLanguage);
    result = {
      word: cleanWord,
      translation: translations[0] || 'Překlad nebyl nalezen.',
      translations,
      status: 0,
      cardId: null,
      created: false,
      unknown: true,
    };
  } else {
    const translations = await translateNewWord(cleanWord, settings);
    const translation = translations[0] || 'Překlad nebyl nalezen.';
    const createdCard = await createCard(cleanWord, translation, settings);

    result = await attachMeanings({
      word: cleanWord,
      translation,
      translations,
      status: normalizeStatus(createdCard?.status ?? 0, createdCard?.extended_status),
      cardId: createdCard?.pk ?? createdCard?.id,
      created: true,
      unknown: true,
    }, cleanWord, settings);
  }

  if (!probe) {
    result.viewCount = await attachSupabaseViewCount(result, settings);
  }
  result.alternativesSource = resolveAlternativesSource(settings);
  return result;
}

function resolveAlternativesSource(settings) {
  const hasKey = Boolean(String(settings.chatgptApiKey || '').trim());
  if (settings.alternativesSource === 'chatgpt' && hasKey && settings.chatgptApiKeyValid === true) {
    return 'chatgpt';
  }
  return 'lingq';
}

function resolveNewWordTranslationSource(settings) {
  const hasKey = Boolean(String(settings.chatgptApiKey || '').trim());
  if (settings.newWordTranslationSource === 'chatgpt' && hasKey && settings.chatgptApiKeyValid === true) {
    return 'chatgpt';
  }
  return 'lingq';
}

async function translateNewWord(word, settings) {
  if (resolveNewWordTranslationSource(settings) === 'chatgpt') {
    try {
      const translations = await fetchChatgptPrimaryTranslations(word, settings);
      if (translations.length > 0) {
        return translations;
      }
    } catch {
      // Při výpadku ChatGPT zůstaneme u LingQ hintů.
    }
  }
  const hint = await findHint(word, settings);
  return extractTranslations(hint, settings.targetLanguage);
}

async function attachMeanings(result) {
  // Další překlady (LingQ i ChatGPT) se načítají až po kliknutí na tlačítko (GET_ALTERNATIVES).
  result.translations = result.translations || [];
  return result;
}

async function getAlternativeTranslations(word, currentTranslation) {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  const cleanWord = normalizeWord(word);
  if (!cleanWord) {
    throw new Error('Chybí slovo pro další překlady.');
  }

  if (resolveAlternativesSource(settings) === 'chatgpt') {
    return fetchChatgptAlternatives(cleanWord, currentTranslation, settings);
  }

  const hint = await findHint(cleanWord, settings);
  return groupAlternativeLines(
    extractTranslations(hint, settings.targetLanguage),
    currentTranslation,
  );
}

async function validateChatgptApiKey(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) {
    throw new Error('ChatGPT API klíč není vyplněný.');
  }
  const response = await fetch('https://api.openai.com/v1/models', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('ChatGPT API klíč není platný nebo nemá oprávnění.');
    }
    throw new Error(`ChatGPT API odpovědělo chybou (${response.status}).`);
  }
  return true;
}

const CHATGPT_TIMEOUT_MS = 40000;

function reply(sendResponse, payload) {
  try {
    sendResponse(payload);
  } catch {
    // Kanál už mohl být zavřený (dlouhé volání / uspaný service worker).
  }
}

async function ensureChatgptApiReady(settings) {
  const apiKey = String(settings.chatgptApiKey || '').trim();
  if (!apiKey) {
    throw new Error('Nejdříve zadejte ChatGPT API klíč v nastavení doplňku.');
  }
  // Klíč se ověřuje v nastavení; při běžném překladu netahat znovu /v1/models.
  if (settings.chatgptApiKeyValid === true) {
    return apiKey;
  }
  try {
    await validateChatgptApiKey(apiKey);
    await chrome.storage.sync.set({ chatgptApiKeyValid: true });
  } catch (error) {
    await chrome.storage.sync.set({
      chatgptApiKeyValid: false,
      alternativesSource: 'lingq',
      newWordTranslationSource: 'lingq',
    });
    throw error;
  }
  return apiKey;
}

async function fetchWithTimeout(url, options, timeoutMs = CHATGPT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('ChatGPT neodpovědělo včas. Zkuste to znovu nebo zvolte rychlejší model.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function callChatgptJson(settings, messages) {
  const apiKey = await ensureChatgptApiReady(settings);
  const model = resolveChatgptModel(settings);
  const requestBody = {
    model,
    response_format: { type: 'json_object' },
    messages,
  };
  if (model.startsWith('gpt-5')) {
    // Bez minimal reasoning GPT-5 defaultně „přemýšlí“ a odezva je velmi dlouhá.
    requestBody.reasoning_effort = 'minimal';
    requestBody.max_completion_tokens = 400;
  } else {
    requestBody.temperature = 0.3;
    requestBody.max_tokens = 400;
  }
  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      await chrome.storage.sync.set({
        chatgptApiKeyValid: false,
        alternativesSource: 'lingq',
        newWordTranslationSource: 'lingq',
      });
      throw new Error('ChatGPT API klíč není platný nebo nemá oprávnění.');
    }
    throw new Error(`ChatGPT API odpovědělo chybou (${response.status}).`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content || '';
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('ChatGPT nevrátilo použitelný JSON.');
  }
  return parsed;
}

function parseChatgptTranslationList(parsed) {
  const list = Array.isArray(parsed?.translations)
    ? parsed.translations
    : Array.isArray(parsed?.meanings)
      ? parsed.meanings
      : [];
  return list
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

async function fetchChatgptPrimaryTranslations(word, settings) {
  const sourceName = languageLabel(settings.language);
  const targetName = languageLabel(settings.targetLanguage);
  const parsed = await callChatgptJson(settings, [
    {
      role: 'system',
      content: 'You translate single words for language learners. Reply with JSON only.',
    },
    {
      role: 'user',
      content: [
        `Word in ${sourceName}: "${word}"`,
        `Target language: ${targetName}`,
        'Return JSON object {"translations":["..."]} with 1 to 5 short dictionary meanings in the target language.',
        'Put the best primary translation first. Prefer distinct senses. No explanations.',
      ].join('\n'),
    },
  ]);
  const translations = parseChatgptTranslationList(parsed);
  if (translations.length === 0) {
    throw new Error('ChatGPT nevrátilo použitelný překlad.');
  }
  return translations;
}

async function fetchChatgptAlternatives(word, currentTranslation, settings) {
  const sourceName = languageLabel(settings.language);
  const targetName = languageLabel(settings.targetLanguage);
  const parsed = await callChatgptJson(settings, [
    {
      role: 'system',
      content: 'You return alternative dictionary meanings for language learners. Reply with JSON only.',
    },
    {
      role: 'user',
      content: [
        `Word in ${sourceName}: "${word}"`,
        `Target language: ${targetName}`,
        currentTranslation ? `Current translation already shown: "${currentTranslation}"` : '',
        'Return JSON object {"translations":["..."]} with 3 to 8 short alternative meanings or synonyms in the target language.',
        'Do not repeat the current translation. Prefer distinct senses. No explanations.',
      ].filter(Boolean).join('\n'),
    },
  ]);
  const translations = parseChatgptTranslationList(parsed);
  if (translations.length === 0) {
    throw new Error('ChatGPT nevrátilo použitelný seznam překladů.');
  }
  return groupAlternativeLines(translations, currentTranslation);
}

function groupAlternativeLines(translations, current) {
  const lines = [];
  const seen = new Set();
  (translations || []).forEach((item) => {
    String(item).split(/\s*(?:;|\n)+\s*|\s+\/\s+/).forEach((part) => {
      const line = part.replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();
      const key = line.toLowerCase();
      if (!line || seen.has(key)) {
        return;
      }
      seen.add(key);
      lines.push(line);
    });
  });
  const have = new Set(String(current || '').split(',').map((part) => part.trim().toLowerCase()).filter(Boolean));
  return lines.filter((line) => {
    const parts = line.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) {
      return false;
    }
    return !parts.every((part) => have.has(part.toLowerCase()));
  });
}

function languageLabel(code) {
  const labels = {
    en: 'English',
    de: 'German',
    es: 'Spanish',
    fr: 'French',
    it: 'Italian',
    pt: 'Portuguese',
    ru: 'Russian',
    pl: 'Polish',
    ja: 'Japanese',
    ko: 'Korean',
    zh: 'Chinese',
    cs: 'Czech',
    sk: 'Slovak',
  };
  return labels[String(code || '').toLowerCase()] || code || 'English';
}

function cardResult(word, card, settings) {
  const translations = extractTranslations(card.hints, settings.targetLanguage);
  return {
    word,
    translation: translations[0] || 'Překlad není k dispozici.',
    translations,
    status: normalizeStatus(card.status, card.extended_status),
    cardId: card.pk ?? card.id,
    created: false,
    unknown: false,
  };
}

async function createCard(word, translation, settings) {
  const url = `${getApiBase(settings)}/cards/`;
  return lingqRequest(url, settings, {
    method: 'POST',
    body: JSON.stringify({
      term: word,
      hints: [{
        locale: settings.targetLanguage,
        text: translation,
      }],
      status: 0,
    }),
  });
}

async function ensureCardId(cardId, word, translation, settings) {
  if (cardId) {
    return String(cardId);
  }
  const cleanWord = normalizeWord(word);
  if (!cleanWord) {
    throw new Error('Chybí slovo pro zalo karty v LingQ.');
  }
  const existing = await findCard(cleanWord, settings);
  const existingId = existing?.pk ?? existing?.id ?? null;
  if (existingId) {
    return String(existingId);
  }
  const created = await createCard(cleanWord, translation || cleanWord, settings);
  const createdId = created?.pk ?? created?.id ?? null;
  if (!createdId) {
    throw new Error('LingQ nevrátil identifikátor karty.');
  }
  // Known words často nemají kartu — po zalo zachovej K.
  if (await isKnownWord(cleanWord, settings)) {
    try {
      const { body } = toApiStatus(5);
      await lingqRequest(`${getApiBase(settings)}/cards/${encodeURIComponent(createdId)}/`, settings, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    } catch {
      // Překlad už je uložený; stav K se případně srovná později.
    }
  }
  return String(createdId);
}

async function updateStatus(cardId, status, word, translation = '') {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  if (!settings.apiKey) {
    throw new Error('Tuto kartu nelze aktualizovat.');
  }
  const resolvedCardId = await ensureCardId(cardId, word, translation, settings);
  const { apiStatus, body } = toApiStatus(status);
  const url = `${getApiBase(settings)}/cards/${encodeURIComponent(resolvedCardId)}/`;
  const response = await lingqRequest(url, settings, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  const savedStatus = normalizeStatus(response?.status ?? apiStatus, response?.extended_status ?? body.extended_status);
  if (word) {
    if (savedStatus === 5) {
      rememberKnownWord(word, settings);
    } else {
      forgetKnownWord(word, settings);
    }
    queueSupabaseUpdate({
      word,
      status: savedStatus,
      cardId: resolvedCardId,
    }, settings);
  }
  return {
    status: savedStatus,
    cardId: resolvedCardId,
  };
}

async function updateTranslation(cardId, word, translation) {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  const text = String(translation || '').replace(/\s+/g, ' ').trim();
  if (!settings.apiKey) {
    throw new Error('Tuto kartu nelze aktualizovat.');
  }
  if (!text) {
    throw new Error('Překlad nemůže být prázdný.');
  }

  const resolvedCardId = await ensureCardId(cardId, word, text, settings);
  const cardUrl = `${getApiBase(settings)}/cards/${encodeURIComponent(resolvedCardId)}/`;
  const hintId = await createHint(word, text, settings);
  if (hintId) {
    const card = await lingqRequest(cardUrl, settings, { method: 'GET' });
    const existingIds = (Array.isArray(card?.hints) ? card.hints : [])
      .map((hint) => hint?.id)
      .filter((id) => id && id !== hintId);
    await lingqRequest(cardUrl, settings, {
      method: 'PATCH',
      body: JSON.stringify({ hints: [hintId, ...existingIds] }),
    });
    queueSupabaseUpdate({
      word,
      translation: text,
      cardId: resolvedCardId,
    }, settings);
    return { translation: text, cardId: resolvedCardId };
  }

  const card = await lingqRequest(cardUrl, settings, { method: 'GET' });
  const locale = String(settings.targetLanguage || '').toLowerCase();
  const hints = Array.isArray(card?.hints)
    ? card.hints.map((hint) => ({ locale: hint.locale, text: hint.text }))
    : [];
  const index = hints.findIndex((hint) => String(hint.locale || '').toLowerCase() === locale);
  if (index >= 0) {
    hints[index] = { locale: settings.targetLanguage, text };
  } else {
    hints.unshift({ locale: settings.targetLanguage, text });
  }
  await lingqRequest(cardUrl, settings, {
    method: 'PATCH',
    body: JSON.stringify({ hints }),
  });
  queueSupabaseUpdate({
    word,
    translation: text,
    cardId: resolvedCardId,
  }, settings);
  return { translation: text, cardId: resolvedCardId };
}

async function createHint(word, text, settings) {
  try {
    const createdHint = await lingqRequest(`${getApiBase(settings)}/hints/`, settings, {
      method: 'POST',
      body: JSON.stringify({
        term: normalizeWord(word),
        locale: settings.targetLanguage,
        text,
      }),
    });
    return createdHint?.id ?? createdHint?.pk ?? null;
  } catch {
    return null;
  }
}

function toApiStatus(status) {
  const uiStatus = Number(status);
  if (!Number.isInteger(uiStatus) || uiStatus < 1 || uiStatus > 5) {
    throw new Error('Neplatná úroveň znalosti.');
  }
  const apiStatus = uiStatus === 5 ? 3 : uiStatus - 1;
  const body = uiStatus === 5
    ? { status: 3, extended_status: 3 }
    : { status: apiStatus, extended_status: null };
  return { apiStatus, body };
}

async function translatePhrase(text) {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  if (!settings.apiKey) {
    throw new Error('Nejdříve zadejte LingQ API klíč v nastavení doplňku.');
  }

  const phrase = String(text || '').replace(/\s+/g, ' ').trim();
  if (!phrase) {
    throw new Error('Vyberte větu.');
  }

  try {
    const hint = await findHint(phrase, settings);
    const fromHint = extractTranslations(hint, settings.targetLanguage)[0] || '';
    if (fromHint && fromHint.toLowerCase() !== phrase.toLowerCase()) {
      return { sentence: phrase, translation: fromHint };
    }
  } catch {
    // U věty často není hotová nápověda, pokračuje se překladem.
  }

  const translation = await translateWithLingq(phrase, settings);
  if (!translation || translation.toLowerCase() === phrase.toLowerCase()) {
    throw new Error('Překlad věty se nepodařilo získat.');
  }
  return { sentence: phrase, translation };
}

async function translateWithLingq(phrase, settings) {
  const language = encodeURIComponent(settings.language);
  const attempts = [
    {
      url: `https://www.lingq.com/api/v3/${language}/ai/translations/`,
      options: { method: 'POST', body: JSON.stringify({ text: phrase, language: settings.targetLanguage }) },
    },
    {
      url: `https://www.lingq.com/api/v3/${language}/translate/`,
      options: { method: 'POST', body: JSON.stringify({ text: phrase, language: settings.targetLanguage, locale: settings.targetLanguage }) },
    },
    {
      url: `https://www.lingq.com/api/v3/${language}/ai/sentence-translation/`,
      options: { method: 'POST', body: JSON.stringify({ sentence: phrase, text: phrase, language: settings.targetLanguage }) },
    },
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const response = await lingqRequest(attempt.url, settings, attempt.options);
      const translation = readTranslation(response, settings.targetLanguage);
      if (translation) {
        return translation;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Překlad věty se nepodařilo získat.');
}

function readTranslation(payload, targetLocale) {
  if (!payload) {
    return '';
  }
  if (typeof payload === 'string') {
    return payload.trim();
  }
  if (typeof payload.translation === 'string') {
    return payload.translation.trim();
  }
  if (payload.translation && typeof payload.translation.text === 'string') {
    return payload.translation.text.trim();
  }
  if (typeof payload.translated_text === 'string') {
    return payload.translated_text.trim();
  }
  if (typeof payload.result === 'string') {
    return payload.result.trim();
  }
  if (Array.isArray(payload.translations)) {
    const item = payload.translations[0];
    if (typeof item === 'string') {
      return item.trim();
    }
    if (item?.text) {
      return String(item.text).trim();
    }
  }
  return extractTranslations(payload.hints || payload, targetLocale)[0] || '';
}

async function findCard(word, settings) {
  const queries = [
    `search=${encodeURIComponent(word)}&page_size=50`,
    `search=${encodeURIComponent(word)}&page_size=20&status=3`,
  ];
  const found = [];

  for (const query of queries) {
    try {
      const response = await lingqRequest(`${getApiBase(settings)}/cards/?${query}`, settings, { method: 'GET' });
      found.push(...listResults(response));
    } catch {
      // Další tvar dotazu zkusí stejné slovo jiným filtrem.
    }
  }

  return bestCard(found, word);
}

function bestCard(results, word) {
  const matches = results.filter((card) => cardMatches(card, word) && Number(card.status) !== -1);
  matches.sort((left, right) => normalizeStatus(right.status, right.extended_status) - normalizeStatus(left.status, left.extended_status));
  return matches[0] || null;
}

function cardMatches(card, word) {
  const target = word.toLowerCase();
  if (String(card?.term || '').toLowerCase() === target) {
    return true;
  }
  const words = Array.isArray(card?.words) ? card.words : [];
  return words.some((item) => String(item).toLowerCase() === target);
}

function listResults(response) {
  if (Array.isArray(response)) {
    return response;
  }
  return Array.isArray(response?.results) ? response.results : [];
}

let knownWordsCache = null;
let knownWordsCachedAt = 0;
let knownWordsLanguage = '';
const KNOWN_WORDS_TTL = 15 * 60 * 1000;
const KNOWN_WORDS_MAX_PAGES = 200;
const KNOWN_WORDS_PAGE_SIZE = 1000;
const IMPORT_KNOWN_BATCH_SIZE = 500;
const CARDS_IMPORT_PAGE_SIZE = 100;
const IMPORT_BATCH_SIZE = 5000;
const IMPORT_COOLDOWN_MS = 60 * 60 * 1000;
const IMPORT_PAGE_DELAY_MS = 400;
const KNOWN_WORDS_SYNC_KEY = 'knownWordsSync';
let knownWordsSyncRunning = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isKnownWord(word, settings) {
  const words = await loadKnownWords(settings);
  return words ? words.has(word.toLowerCase()) : false;
}

function rememberKnownWord(word, settings) {
  changeKnownWord(word, settings, true);
}

function forgetKnownWord(word, settings) {
  changeKnownWord(word, settings, false);
}

function changeKnownWord(word, settings, known) {
  const text = String(word || '').toLowerCase();
  if (!text || !knownWordsCache || knownWordsLanguage !== settings.language) {
    return;
  }
  if (known) {
    knownWordsCache.add(text);
  } else {
    knownWordsCache.delete(text);
  }
  chrome.storage.local.set({
    knownWords: [...knownWordsCache],
    knownWordsAt: knownWordsCachedAt,
    knownLanguage: settings.language,
  });
}

async function loadKnownWords(settings) {
  const now = Date.now();
  if (knownWordsCache && knownWordsLanguage === settings.language && now - knownWordsCachedAt < KNOWN_WORDS_TTL) {
    return knownWordsCache;
  }

  const stored = await chrome.storage.local.get(['knownWords', 'knownWordsAt', 'knownLanguage']);
  if (stored.knownLanguage === settings.language && Array.isArray(stored.knownWords) && stored.knownWordsAt && now - stored.knownWordsAt < KNOWN_WORDS_TTL) {
    knownWordsCache = new Set(stored.knownWords);
    knownWordsCachedAt = stored.knownWordsAt;
    knownWordsLanguage = settings.language;
    return knownWordsCache;
  }

  return fetchAllKnownWords(settings);
}

async function fetchAllKnownWords(settings, { onProgress } = {}) {
  const language = encodeURIComponent(settings.language);
  const bases = [
    `https://www.lingq.com/api/v2/${language}/known-words/`,
    `https://www.lingq.com/api/v3/${language}/known-words/`,
  ];
  const now = Date.now();

  for (const base of bases) {
    const words = new Set();
    try {
      let url = `${base}?page=1&page_size=${KNOWN_WORDS_PAGE_SIZE}`;
      for (let page = 0; url && page < KNOWN_WORDS_MAX_PAGES; page += 1) {
        await noteUserActivity();
        const response = await lingqRequest(url, settings, { method: 'GET' });
        const before = words.size;
        collectKnownWords(response, words);
        if (typeof onProgress === 'function') {
          await onProgress({ fetched: words.size, page: page + 1 });
        }
        if (page === 0 && words.size === before) {
          break;
        }
        url = typeof response?.next === 'string' ? response.next : '';
      }
    } catch {
      // Použijí se slova stažená před chybou další stránky.
    }

    if (words.size === 0) {
      continue;
    }

    knownWordsCache = words;
    knownWordsCachedAt = now;
    knownWordsLanguage = settings.language;
    await chrome.storage.local.set({
      knownWords: [...words],
      knownWordsAt: now,
      knownLanguage: settings.language,
    });
    return knownWordsCache;
  }

  return null;
}

async function setKnownWordsSyncProgress(progress) {
  const stored = await chrome.storage.local.get(KNOWN_WORDS_SYNC_KEY);
  const previous = stored[KNOWN_WORDS_SYNC_KEY] && typeof stored[KNOWN_WORDS_SYNC_KEY] === 'object'
    ? stored[KNOWN_WORDS_SYNC_KEY]
    : {};
  const payload = {
    ...previous,
    ...progress,
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [KNOWN_WORDS_SYNC_KEY]: payload });
  return payload;
}

function rememberVocabularyEntry(map, word, status, meta = {}) {
  const text = String(word || '').trim().toLowerCase();
  const level = Number(status);
  if (!text || !Number.isInteger(level) || level < 1 || level > 5) {
    return;
  }
  const meaning = String(meta.translation || '').replace(/\s+/g, ' ').trim() || null;
  const importance = Number.isInteger(Number(meta.importance)) ? Number(meta.importance) : null;
  const popularity = Number.isInteger(Number(meta.popularity)) ? Number(meta.popularity) : null;
  const previous = map.get(text) || {
    status: 0,
    translation: null,
    importance: null,
    popularity: null,
  };
  const nextStatus = Math.max(previous.status, level);
  let nextTranslation = previous.translation;
  let nextImportance = previous.importance;
  let nextPopularity = previous.popularity;
  if (level >= previous.status) {
    if (meaning) {
      nextTranslation = meaning;
    }
    if (importance != null) {
      nextImportance = importance;
    }
    if (popularity != null) {
      nextPopularity = popularity;
    }
  } else {
    if (!nextTranslation && meaning) {
      nextTranslation = meaning;
    }
    if (nextImportance == null && importance != null) {
      nextImportance = importance;
    }
    if (nextPopularity == null && popularity != null) {
      nextPopularity = popularity;
    }
  }
  map.set(text, {
    status: nextStatus,
    translation: nextTranslation,
    importance: nextImportance,
    popularity: nextPopularity,
  });
}

// term = originál; hints[].text (cílový locale, jinak první hint) = překlad; popularity z hintu; importance z karty
function cardImportMeta(card, settings) {
  const hints = Array.isArray(card?.hints) ? card.hints : [];
  const locale = String(settings.targetLanguage || '').toLowerCase();
  const preferred = hints.filter((hint) => String(hint?.locale || '').toLowerCase() === locale);
  const pool = (preferred.length > 0 ? preferred : hints).slice();
  pool.sort((left, right) => Number(right?.popularity || 0) - Number(left?.popularity || 0));
  const hint = pool[0] || null;
  const translation = String(hint?.text || '').replace(/\s+/g, ' ').trim() || null;
  const popularity = Number.isInteger(Number(hint?.popularity)) ? Number(hint.popularity) : null;
  const importance = Number.isInteger(Number(card?.importance)) ? Number(card.importance) : null;
  return { translation, importance, popularity };
}

function defaultImportProgress(language) {
  return {
    language,
    phase: 'cards',
    totalCards: 0,
    importedCards: 0,
    cardsNextPage: 1,
    cardsNextUrl: null,
    knownTotal: 0,
    knownImported: 0,
    knownNextPage: 1,
    knownNextUrl: null,
    batchSize: IMPORT_BATCH_SIZE,
    cooldownMs: IMPORT_COOLDOWN_MS,
    lastBatchAt: null,
    cooldownUntil: null,
    running: false,
    insertedTotal: 0,
    updatedTotal: 0,
    lastBatchInserted: 0,
    lastBatchUpdated: 0,
    lastBatchFetched: 0,
    error: null,
    message: '',
  };
}

function enrichImportProgress(progress) {
  const now = Date.now();
  const cooldownUntil = Number(progress?.cooldownUntil) || 0;
  const cooldownRemainingMs = Math.max(0, cooldownUntil - now);
  const phase = progress?.phase || 'cards';
  const total = phase === 'known'
    ? Number(progress.knownTotal) || 0
    : Number(progress.totalCards) || 0;
  const imported = phase === 'known'
    ? Number(progress.knownImported) || 0
    : Number(progress.importedCards) || 0;
  const percent = total > 0 ? Math.min(100, Math.round((imported / total) * 100)) : 0;
  return {
    ...progress,
    cooldownRemainingMs,
    canImport: !progress?.running
      && progress?.phase !== 'done'
      && cooldownRemainingMs <= 0,
    axisTotal: total,
    axisImported: imported,
    axisPercent: percent,
  };
}

async function readImportProgress() {
  const stored = await chrome.storage.local.get(KNOWN_WORDS_SYNC_KEY);
  const raw = stored[KNOWN_WORDS_SYNC_KEY];
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  return enrichImportProgress(raw);
}

async function fetchLingqCardsTotal(settings) {
  const params = new URLSearchParams({
    page: '1',
    page_size: '1',
    sort: 'alpha',
  });
  [0, 1, 2, 3, 4].forEach((status) => params.append('status', String(status)));
  const response = await lingqRequest(`${getApiBase(settings)}/cards/?${params}`, settings, { method: 'GET' });
  return Number(response?.count) || 0;
}

async function fetchLingqKnownTotal(settings) {
  const language = encodeURIComponent(settings.language);
  const urls = [
    `https://www.lingq.com/api/v2/${language}/known-words/?page=1&page_size=1`,
    `https://www.lingq.com/api/v3/${language}/known-words/?page=1&page_size=1`,
  ];
  for (const url of urls) {
    try {
      const response = await lingqRequest(url, settings, { method: 'GET' });
      if (Number.isFinite(Number(response?.count))) {
        return Number(response.count);
      }
    } catch {
      // Zkus další endpoint.
    }
  }
  return 0;
}

async function ensureImportProgress(settings, { forceRefreshTotals = false } = {}) {
  const language = settings.language || 'en';
  let progress = await readImportProgress();
  if (!progress || progress.language !== language) {
    progress = enrichImportProgress(defaultImportProgress(language));
  }

  if (forceRefreshTotals || !progress.totalCards) {
    progress.totalCards = await fetchLingqCardsTotal(settings);
  }
  if (forceRefreshTotals || !progress.knownTotal) {
    try {
      progress.knownTotal = await fetchLingqKnownTotal(settings);
    } catch {
      progress.knownTotal = Number(progress.knownTotal) || 0;
    }
  }

  if (!progress.batchSize) {
    progress.batchSize = IMPORT_BATCH_SIZE;
  }
  if (!progress.cooldownMs) {
    progress.cooldownMs = IMPORT_COOLDOWN_MS;
  }

  const saved = enrichImportProgress(progress);
  await chrome.storage.local.set({ [KNOWN_WORDS_SYNC_KEY]: saved });
  return saved;
}

function cardsListUrl(settings, page) {
  const params = new URLSearchParams({
    page: String(page || 1),
    page_size: String(CARDS_IMPORT_PAGE_SIZE),
    sort: 'alpha',
  });
  [0, 1, 2, 3, 4].forEach((status) => params.append('status', String(status)));
  return `${getApiBase(settings)}/cards/?${params}`;
}

async function fetchNextCardsBatch(settings, progress, { onProgress } = {}) {
  const byWord = new Map();
  let fetchedCards = 0;
  let page = Number(progress.cardsNextPage) || 1;
  let url = progress.cardsNextUrl || cardsListUrl(settings, page);
  let totalCards = Number(progress.totalCards) || 0;
  const limit = Number(progress.batchSize) || IMPORT_BATCH_SIZE;

  while (fetchedCards < limit && url) {
    await noteUserActivity();
    let response;
    try {
      response = await lingqRequest(url, settings, { method: 'GET' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/429|Too Many Requests|rate/i.test(message)) {
        const err = new Error('LingQ dočasně omezilo API (429). Počkejte na cooldown a zkuste další dávku.');
        err.code = 'RATE_LIMIT';
        err.partial = {
          items: mapVocabularyEntries(byWord),
          fetchedCards,
          nextPage: page,
          nextUrl: url,
          totalCards,
        };
        throw err;
      }
      throw error;
    }

    if (Number.isFinite(Number(response?.count))) {
      totalCards = Number(response.count);
    }
    const cards = listResults(response);
    if (cards.length === 0) {
      url = null;
      page += 1;
      break;
    }

    cards.forEach((card) => {
      if (Number(card?.status) === -1) {
        return;
      }
      const term = String(card?.term || '').trim();
      if (!term) {
        return;
      }
      const status = normalizeStatus(card.status, card.extended_status);
      rememberVocabularyEntry(byWord, term, status, cardImportMeta(card, settings));
    });
    fetchedCards += cards.length;
    if (typeof onProgress === 'function') {
      await onProgress({
        fetchedCards: (Number(progress.importedCards) || 0) + fetchedCards,
        batchFetched: fetchedCards,
        totalCards,
      });
    }

    url = typeof response?.next === 'string' ? response.next : '';
    page += 1;
    if (url && fetchedCards < limit) {
      await sleep(IMPORT_PAGE_DELAY_MS);
    }
  }

  return {
    items: mapVocabularyEntries(byWord),
    fetchedCards,
    nextPage: url ? page : null,
    nextUrl: url || null,
    totalCards,
    done: !url,
  };
}

function mapVocabularyEntries(byWord) {
  return [...byWord.entries()]
    .map(([word, entry]) => ({
      word,
      status: entry.status,
      translation: entry.translation || null,
      importance: entry.importance,
      popularity: entry.popularity,
    }))
    .sort((left, right) => left.word.localeCompare(right.word, 'en'));
}

async function fetchNextKnownBatch(settings, progress, { onProgress } = {}) {
  const language = encodeURIComponent(settings.language);
  const bases = [
    `https://www.lingq.com/api/v2/${language}/known-words/`,
    `https://www.lingq.com/api/v3/${language}/known-words/`,
  ];
  const limit = Number(progress.batchSize) || IMPORT_BATCH_SIZE;
  const words = [];
  let page = Number(progress.knownNextPage) || 1;
  let url = progress.knownNextUrl || `${bases[0]}?page=${page}&page_size=${KNOWN_WORDS_PAGE_SIZE}`;
  let total = Number(progress.knownTotal) || 0;
  let usedBase = bases[0];

  for (const base of bases) {
    if (progress.knownNextUrl) {
      break;
    }
    try {
      const probe = await lingqRequest(`${base}?page=1&page_size=1`, settings, { method: 'GET' });
      if (probe) {
        usedBase = base;
        if (Number.isFinite(Number(probe.count))) {
          total = Number(probe.count);
        }
        url = `${base}?page=${page}&page_size=${KNOWN_WORDS_PAGE_SIZE}`;
        break;
      }
    } catch {
      // Zkus další.
    }
  }

  while (words.length < limit && url) {
    await noteUserActivity();
    let response;
    try {
      response = await lingqRequest(url, settings, { method: 'GET' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/429|Too Many Requests|rate/i.test(message)) {
        const err = new Error('LingQ dočasně omezilo API (429). Počkejte na cooldown a zkuste další dávku.');
        err.code = 'RATE_LIMIT';
        err.partial = {
          items: words.map((word) => ({ word, status: 5, translation: null, importance: null, popularity: null })),
          fetched: words.length,
          nextPage: page,
          nextUrl: url,
          total,
        };
        throw err;
      }
      throw error;
    }

    if (Number.isFinite(Number(response?.count))) {
      total = Number(response.count);
    }
    const before = words.length;
    const bucket = new Set();
    collectKnownWords(response, bucket);
    bucket.forEach((word) => {
      if (words.length < limit) {
        words.push(word);
      }
    });
    if (typeof onProgress === 'function') {
      await onProgress({
        fetchedKnown: (Number(progress.knownImported) || 0) + words.length,
        batchFetched: words.length,
        knownTotal: total,
      });
    }
    if (words.length === before) {
      url = null;
      break;
    }
    url = typeof response?.next === 'string' ? response.next : null;
    if (url) {
      page += 1;
    }
    if (url && words.length < limit) {
      await sleep(IMPORT_PAGE_DELAY_MS);
    }
  }

  return {
    items: words.map((word) => ({
      word,
      status: 5,
      translation: null,
      importance: null,
      popularity: null,
    })),
    fetched: words.length,
    nextPage: url ? page : null,
    nextUrl: url || null,
    total,
    done: !url,
  };
}

async function uploadVocabularyItems(settings, items, { onProgress } = {}) {
  let uploaded = 0;
  let inserted = 0;
  let updated = 0;
  for (let offset = 0; offset < items.length; offset += IMPORT_KNOWN_BATCH_SIZE) {
    await noteUserActivity();
    const batch = items.slice(offset, offset + IMPORT_KNOWN_BATCH_SIZE);
    const counts = await importLingqWordsBatch(settings, settings.language || 'en', batch);
    uploaded += Number(counts.processed) || batch.length;
    inserted += Number(counts.inserted) || 0;
    updated += Number(counts.updated) || 0;
    if (typeof onProgress === 'function') {
      await onProgress({ uploaded, inserted, updated, total: items.length });
    }
  }
  return { uploaded, inserted, updated };
}

async function syncKnownWordsToSupabase() {
  if (knownWordsSyncRunning) {
    throw new Error('Import už běží. Počkejte na dokončení.');
  }

  knownWordsSyncRunning = true;
  const settings = await chrome.storage.sync.get(DEFAULTS);
  try {
    if (!settings.apiKey) {
      throw new Error('Nejdříve zadejte LingQ API klíč v nastavení doplňku.');
    }
    const baseUrl = String(settings.supabaseUrl || '').replace(/\/$/, '');
    const apiKey = String(settings.supabaseKey || '').trim();
    if (!baseUrl || !apiKey) {
      throw new Error('Nejdříve vyplňte Supabase URL a klíč v nastavení.');
    }

    let progress = await ensureImportProgress(settings, { forceRefreshTotals: true });
    if (progress.phase === 'done') {
      return enrichImportProgress({
        ...progress,
        message: 'Import je hotový. Všechna dostupná slovíčka už byla stažena.',
      });
    }

    const remaining = Number(progress.cooldownUntil) - Date.now();
    if (remaining > 0) {
      const minutes = Math.ceil(remaining / 60000);
      throw new Error(`Další dávka bude dostupná za cca ${minutes} min (ochrana proti blokaci LingQ API).`);
    }

    progress = enrichImportProgress({
      ...progress,
      running: true,
      error: null,
      message: progress.phase === 'known'
        ? 'Stahuji dávku known words…'
        : 'Stahuji dávku Vocabulary karet…',
    });
    await chrome.storage.local.set({ [KNOWN_WORDS_SYNC_KEY]: progress });

    let batchResult;
    try {
      if (progress.phase === 'known') {
        batchResult = await fetchNextKnownBatch(settings, progress, {
          onProgress: async ({ fetchedKnown, knownTotal }) => {
            await setKnownWordsSyncProgress({
              running: true,
              phase: 'known',
              knownImported: fetchedKnown,
              knownTotal,
              axisImported: fetchedKnown,
              axisTotal: knownTotal,
              message: `Stahuji known words… ${fetchedKnown} / ${knownTotal}`,
            }).catch(() => {});
          },
        });
      } else {
        batchResult = await fetchNextCardsBatch(settings, progress, {
          onProgress: async ({ fetchedCards, totalCards }) => {
            await setKnownWordsSyncProgress({
              running: true,
              phase: 'cards',
              importedCards: fetchedCards,
              totalCards,
              axisImported: fetchedCards,
              axisTotal: totalCards,
              message: `Stahuji karty… ${fetchedCards} / ${totalCards}`,
            }).catch(() => {});
          },
        });
      }
    } catch (error) {
      if (error?.code === 'RATE_LIMIT' && error.partial?.items?.length) {
        const upload = await uploadVocabularyItems(settings, error.partial.items);
        const cooldownUntil = Date.now() + (progress.cooldownMs || IMPORT_COOLDOWN_MS);
        const next = enrichImportProgress({
          ...progress,
          running: false,
          importedCards: progress.phase === 'cards'
            ? (Number(progress.importedCards) || 0) + (error.partial.fetchedCards || error.partial.fetched || 0)
            : progress.importedCards,
          cardsNextPage: progress.phase === 'cards' ? error.partial.nextPage : progress.cardsNextPage,
          cardsNextUrl: progress.phase === 'cards' ? error.partial.nextUrl : progress.cardsNextUrl,
          knownImported: progress.phase === 'known'
            ? (Number(progress.knownImported) || 0) + (error.partial.fetched || 0)
            : progress.knownImported,
          knownNextPage: progress.phase === 'known' ? error.partial.nextPage : progress.knownNextPage,
          knownNextUrl: progress.phase === 'known' ? error.partial.nextUrl : progress.knownNextUrl,
          totalCards: error.partial.totalCards || progress.totalCards,
          knownTotal: error.partial.total || progress.knownTotal,
          lastBatchAt: Date.now(),
          cooldownUntil,
          insertedTotal: (Number(progress.insertedTotal) || 0) + upload.inserted,
          updatedTotal: (Number(progress.updatedTotal) || 0) + upload.updated,
          lastBatchInserted: upload.inserted,
          lastBatchUpdated: upload.updated,
          lastBatchFetched: error.partial.items.length,
          error: error.message,
          message: error.message,
        });
        await chrome.storage.local.set({ [KNOWN_WORDS_SYNC_KEY]: next });
        throw error;
      }
      throw error;
    }

    await setKnownWordsSyncProgress({
      running: true,
      message: `Nahrávám ${batchResult.items.length} slovíček do DB…`,
    });

    const upload = batchResult.items.length
      ? await uploadVocabularyItems(settings, batchResult.items, {
        onProgress: async ({ uploaded, total }) => {
          await setKnownWordsSyncProgress({
            running: true,
            message: `Nahrávám do DB… ${uploaded} / ${total}`,
          }).catch(() => {});
        },
      })
      : { uploaded: 0, inserted: 0, updated: 0 };

    const cooldownUntil = Date.now() + (progress.cooldownMs || IMPORT_COOLDOWN_MS);
    let nextPhase = progress.phase;
    let message;

    if (progress.phase === 'cards') {
      const importedCards = (Number(progress.importedCards) || 0) + (batchResult.fetchedCards || 0);
      const cardsDone = batchResult.done || (
        progress.totalCards > 0 && importedCards >= progress.totalCards
      );
      nextPhase = cardsDone ? 'known' : 'cards';
      progress = {
        ...progress,
        importedCards,
        totalCards: batchResult.totalCards || progress.totalCards,
        cardsNextPage: batchResult.nextPage,
        cardsNextUrl: batchResult.nextUrl,
        phase: nextPhase,
      };
      message = cardsDone
        ? `Karty hotové (${importedCards}). Po cooldownu se začnou importovat known words (bez překladu zůstanou prázdné).`
        : `Staženo karet ${importedCards} / ${progress.totalCards}. Další dávka po cooldownu.`;
    } else {
      const knownImported = (Number(progress.knownImported) || 0) + (batchResult.fetched || 0);
      const knownDone = batchResult.done || (
        progress.knownTotal > 0 && knownImported >= progress.knownTotal
      );
      nextPhase = knownDone ? 'done' : 'known';
      progress = {
        ...progress,
        knownImported,
        knownTotal: batchResult.total || progress.knownTotal,
        knownNextPage: batchResult.nextPage,
        knownNextUrl: batchResult.nextUrl,
        phase: nextPhase,
      };
      message = knownDone
        ? `Import hotový (karty + known words). Known words ${knownImported} / ${progress.knownTotal}.`
        : `Staženo known words ${knownImported} / ${progress.knownTotal} (překlad prázdný, pokud ho karta neměla). Další dávka po cooldownu.`;
    }

    const result = enrichImportProgress({
      ...progress,
      running: false,
      lastBatchAt: Date.now(),
      cooldownUntil: nextPhase === 'done' ? null : cooldownUntil,
      insertedTotal: (Number(progress.insertedTotal) || 0) + upload.inserted,
      updatedTotal: (Number(progress.updatedTotal) || 0) + upload.updated,
      lastBatchInserted: upload.inserted,
      lastBatchUpdated: upload.updated,
      lastBatchFetched: batchResult.items.length,
      error: null,
      message,
    });
    await chrome.storage.local.set({ [KNOWN_WORDS_SYNC_KEY]: result });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Import slovíček z LingQ se nezdařil.';
    const current = await readImportProgress();
    await setKnownWordsSyncProgress({
      ...(current || {}),
      running: false,
      error: message,
      message,
    });
    throw error;
  } finally {
    knownWordsSyncRunning = false;
  }
}

async function importLingqWordsBatch(settings, language, items) {
  const baseUrl = String(settings.supabaseUrl || '').replace(/\/$/, '');
  const apiKey = String(settings.supabaseKey || '').trim();
  const words = items.map((item) => item.word);
  const statuses = items.map((item) => item.status);
  const translations = items.map((item) => item.translation || null);
  const importance = items.map((item) => (
    Number.isInteger(Number(item.importance)) ? Number(item.importance) : null
  ));
  const popularity = items.map((item) => (
    Number.isInteger(Number(item.popularity)) ? Number(item.popularity) : null
  ));
  const response = await fetch(`${baseUrl}/rest/v1/rpc/import_lingq_words`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_language: language || settings.language || 'en',
      p_words: words,
      p_statuses: statuses,
      p_translations: translations,
      p_importance: importance,
      p_popularity: popularity,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    const lower = text.toLowerCase();
    if (
      response.status === 404
      || lower.includes('import_lingq_words')
      || lower.includes('import_known_words')
      || lower.includes('could not find the function')
      || lower.includes('pgrst202')
    ) {
      throw new Error(
        'V databázi chybí funkce import_lingq_words. Spusťte supabase/import_known_words.sql ve svém projektu Supabase (SQL Editor).'
      );
    }
    throw new Error(`Supabase odpovědělo chybou (${response.status}).`);
  }

  if (!text) {
    return { processed: items.length, inserted: 0, updated: 0 };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { processed: items.length, inserted: 0, updated: 0 };
  }
}

function collectKnownWords(response, words) {
  const items = [];
  if (Array.isArray(response)) {
    items.push(...response);
  }
  if (Array.isArray(response?.results)) {
    items.push(...response.results);
  }
  if (Array.isArray(response?.words)) {
    items.push(...response.words);
  }
  items.forEach((item) => {
    const text = knownItemText(item);
    if (text) {
      words.add(text);
    }
  });
}

function knownItemText(item) {
  if (typeof item === 'string') {
    return item.toLowerCase();
  }
  return String(item?.word || item?.term || item?.text || '').toLowerCase();
}

async function findHint(word, settings) {
  const url = `${getHintsBase(settings)}/?word=${encodeURIComponent(word)}`;
  const response = await lingqRequest(url, settings, { method: 'GET' });

  if (Array.isArray(response)) {
    return response;
  }

  if (response && typeof response === 'object') {
    const lowerWord = word.toLowerCase();
    const key = Object.keys(response).find((item) => item.toLowerCase() === lowerWord);
    if (key) {
      return response[key];
    }
  }

  return response?.results || response?.hints || null;
}

async function lingqRequest(url, settings, options) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Token ${settings.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('LingQ API klíč není platný nebo nemá potřebná oprávnění.');
    }
    if (response.status === 404) {
      throw new Error('LingQ API tuto operaci nepodporuje. Zkontrolujte jazyk a API klíč.');
    }
    throw new Error(`LingQ API odpovědělo chybou (${response.status}).`);
  }

  return response.json();
}

function getApiBase(settings) {
  return `https://www.lingq.com/api/v3/${encodeURIComponent(settings.language)}`;
}

function getHintsBase(settings) {
  return `https://www.lingq.com/api/languages/${encodeURIComponent(settings.language)}/hints`;
}

function normalizeStatus(status, extendedStatus) {
  if (typeof status === 'string' && status.toLowerCase() === 'known') {
    return 5;
  }

  const numericStatus = Number(status);
  const extended = extendedStatus == null || extendedStatus === '' ? null : Number(extendedStatus);
  if (!Number.isInteger(numericStatus)) {
    return 1;
  }
  if (numericStatus === 4 || (numericStatus === 3 && extended === 3)) {
    return 5;
  }
  if (numericStatus === 3) {
    return 4;
  }
  return Math.max(1, Math.min(4, numericStatus + 1));
}

function extractTranslations(hint, targetLocale) {
  const hints = Array.isArray(hint) ? hint : (hint ? [hint] : []);
  const preferred = hints.filter((item) => String(item?.locale || '').toLowerCase() === String(targetLocale || '').toLowerCase());
  const other = hints.filter((item) => !preferred.includes(item));
  const ordered = [...preferred, ...other];
  const translations = ordered
    .map((item) => typeof item === 'string' ? item.trim() : item?.text?.trim() || item?.translation?.trim() || item?.definition?.trim() || '')
    .filter(Boolean);
  return [...new Set(translations)];
}

function normalizeWord(word) {
  return String(word || '').replace(/["'""‚''.!,?;:()[\]{}<>]/g, '').trim();
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : 'Nepodařilo se spojit s LingQ.';
}

async function attachSupabaseViewCount(result, settings) {
  if (!result?.word || !isSupabaseConfigured(settings)) {
    return null;
  }
  try {
    const gate = await getSupabaseGate();
    if (!gate.ready) {
      return null;
    }
    const row = await syncSupabaseWord('touch_word', {
      word: result.word,
      translation: result.translation,
      status: result.status,
      cardId: result.cardId,
    }, settings);
    const viewCount = Number(row?.view_count);
    // Nový záznam začíná na 1 — v bublině ukazujeme počet jen u už dříve viděných slov.
    return Number.isInteger(viewCount) && viewCount > 1 ? viewCount : null;
  } catch {
    // LingQ bublina zůstane, i když sync do Supabase selže.
    return null;
  }
}

function queueSupabaseUpdate(fields, settings) {
  if (!fields?.word || !isSupabaseConfigured(settings)) {
    return;
  }
  getSupabaseGate().then((gate) => {
    if (!gate.ready) {
      return;
    }
    syncSupabaseWord('update_word_fields', fields, settings).catch(() => {
      // Aktualizace LingQ už proběhla; databáze se zkusí příště.
    });
  }).catch(() => {});
}

const EXTENSION_SCHEMA_VERSION = '3';
const SUPABASE_INSTALL_SQL_FILES = [
  'supabase/schema.sql',
  'supabase/import_known_words.sql',
  'supabase/usage_stats.sql',
  'supabase/latency.sql',
  'supabase/latency_status_phrase.sql',
  'supabase/schema_version.sql',
];
const SUPABASE_DB_REQUIRED_MESSAGE = 'Supabase není připravená. V Nastavení vyplňte URL a klíč, nainstalujte schéma a spusťte Zkontrolovat databázi.';

let supabaseReadyCache = {
  key: '',
  ready: false,
  checkedAt: 0,
  message: '',
};
const SUPABASE_READY_TTL_MS = 5 * 60 * 1000;

function isSupabaseConfigured(settings) {
  const baseUrl = String(settings?.supabaseUrl || '').trim().replace(/\/$/, '');
  const apiKey = String(settings?.supabaseKey || '').trim();
  return Boolean(baseUrl && apiKey);
}

function supabaseSettingsCacheKey(settings) {
  return `${String(settings?.supabaseUrl || '').trim().replace(/\/$/, '')}|${String(settings?.supabaseKey || '').trim()}`;
}

function invalidateSupabaseReadyCache() {
  supabaseReadyCache = { key: '', ready: false, checkedAt: 0, message: '' };
}

function rememberSupabaseReady(ready, override = null) {
  const settings = override || {};
  // Přepočet klíče z override, jinak necháme prázdný — getSupabaseGate doplní ze storage.
  const key = supabaseSettingsCacheKey(settings);
  supabaseReadyCache = {
    key,
    ready: ready === true,
    checkedAt: Date.now(),
    message: ready
      ? `Databáze je připravená (schéma v${EXTENSION_SCHEMA_VERSION}).`
      : SUPABASE_DB_REQUIRED_MESSAGE,
  };
}

async function getSupabaseGate({ force = false } = {}) {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  const configured = isSupabaseConfigured(settings);
  if (!configured) {
    invalidateSupabaseReadyCache();
    return {
      ready: false,
      configured: false,
      message: 'Nejdříve vyplňte Supabase URL a publishable klíč v Nastavení.',
      expectedVersion: EXTENSION_SCHEMA_VERSION,
      installedVersion: null,
    };
  }

  const key = supabaseSettingsCacheKey(settings);
  const cacheHit = !force
    && supabaseReadyCache.key === key
    && supabaseReadyCache.checkedAt
    && (Date.now() - supabaseReadyCache.checkedAt) < SUPABASE_READY_TTL_MS;
  if (cacheHit) {
    return {
      ready: supabaseReadyCache.ready,
      configured: true,
      message: supabaseReadyCache.message || (supabaseReadyCache.ready
        ? `Databáze je připravená (schéma v${EXTENSION_SCHEMA_VERSION}).`
        : SUPABASE_DB_REQUIRED_MESSAGE),
      expectedVersion: EXTENSION_SCHEMA_VERSION,
      installedVersion: null,
      fromCache: true,
    };
  }

  try {
    const check = await checkSupabaseSchema(settings);
    supabaseReadyCache = {
      key,
      ready: check.ready === true,
      checkedAt: Date.now(),
      message: check.message,
    };
    return {
      ...check,
      ready: check.ready === true,
      configured: true,
      fromCache: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : SUPABASE_DB_REQUIRED_MESSAGE;
    supabaseReadyCache = {
      key,
      ready: false,
      checkedAt: Date.now(),
      message,
    };
    return {
      ready: false,
      configured: true,
      message,
      expectedVersion: EXTENSION_SCHEMA_VERSION,
      installedVersion: null,
      fromCache: false,
    };
  }
}

async function requireSupabaseReady() {
  const gate = await getSupabaseGate();
  if (!gate.ready) {
    throw new Error(gate.message || SUPABASE_DB_REQUIRED_MESSAGE);
  }
  return gate;
}

async function resolveSupabaseSettings(override = null) {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  const baseUrl = String(override?.supabaseUrl || stored.supabaseUrl || '').trim().replace(/\/$/, '');
  const apiKey = String(override?.supabaseKey || stored.supabaseKey || '').trim();
  if (!baseUrl || !apiKey) {
    throw new Error('Nejdříve vyplňte Supabase URL a publishable klíč.');
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(baseUrl)) {
    throw new Error('Supabase URL má vypadat jako https://xxxx.supabase.co');
  }
  return { baseUrl, apiKey, projectRef: baseUrl.replace(/^https:\/\//i, '').split('.')[0] };
}

async function supabaseRest(baseUrl, apiKey, path, { method = 'GET', body = null } = {}) {
  const headers = {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };
  if (body != null) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, text, json };
}

function supabaseMissingMessage(payload) {
  const text = typeof payload === 'string'
    ? payload
    : String(payload?.message || payload?.error || JSON.stringify(payload || '') || '');
  return /could not find|does not exist|schema cache|PGRST/i.test(text);
}

async function checkSupabaseSchema(override = null) {
  const { baseUrl, apiKey } = await resolveSupabaseSettings(override);
  const missing = [];
  const present = [];

  const tableChecks = [
    {
      id: 'words',
      path: '/rest/v1/words?select=id,word,language,translation,status,view_count,lingq_card_id,created_at,updated_at,import_note,importance,popularity&limit=1',
    },
    {
      id: 'usage_events',
      path: '/rest/v1/usage_events?select=id,event_type,word,language,status,created_at&limit=1',
    },
    {
      id: 'lingq_latency',
      path: '/rest/v1/lingq_latency?select=id,kind,word,language,word_status,duration_ms,ok,error,created_at&limit=1',
    },
    {
      id: 'lingq_extension_meta',
      path: '/rest/v1/lingq_extension_meta?select=key,value,updated_at&limit=1',
    },
  ];

  for (const check of tableChecks) {
    const { response, json, text } = await supabaseRest(baseUrl, apiKey, check.path);
    if (response.ok) {
      present.push(`tabulka ${check.id}`);
    } else if (response.status === 401 || response.status === 403) {
      throw new Error('Supabase klíč není platný nebo nemá oprávnění ke čtení tabulek.');
    } else if (supabaseMissingMessage(json || text)) {
      missing.push(`tabulka ${check.id}`);
    } else {
      missing.push(`tabulka ${check.id} (chyba ${response.status})`);
    }
  }

  const requiredRpcs = ['touch_word', 'update_word_fields', 'import_lingq_words', 'get_usage_stats'];
  const openApiResponse = await fetch(`${baseUrl}/rest/v1/`, {
    method: 'GET',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/openapi+json',
    },
  });
  let rpcPaths = new Set();
  if (openApiResponse.ok) {
    try {
      const spec = await openApiResponse.json();
      Object.keys(spec?.paths || {}).forEach((path) => {
        const match = path.match(/^\/rpc\/([^/{]+)/);
        if (match) {
          rpcPaths.add(match[1]);
        }
      });
    } catch {
      rpcPaths = new Set();
    }
  }

  for (const rpcName of requiredRpcs) {
    if (rpcPaths.size > 0) {
      if (rpcPaths.has(rpcName)) {
        present.push(`funkce ${rpcName}`);
      } else {
        missing.push(`funkce ${rpcName}`);
      }
      continue;
    }

    // Fallback bez OpenAPI — bez zápisu slovíček (prázdné / neúplné args).
    const body = rpcName === 'import_lingq_words'
      ? { p_language: 'en', p_words: [], p_statuses: [] }
      : (rpcName === 'get_usage_stats' ? { p_language: 'en' } : {});
    const { response, json, text } = await supabaseRest(baseUrl, apiKey, `/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      body,
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error('Supabase klíč není platný nebo nemá oprávnění k RPC funkcím.');
    }
    if (supabaseMissingMessage(json || text)) {
      missing.push(`funkce ${rpcName}`);
    } else {
      present.push(`funkce ${rpcName}`);
    }
  }

  let installedVersion = null;
  const versionProbe = await supabaseRest(
    baseUrl,
    apiKey,
    '/rest/v1/lingq_extension_meta?select=value&key=eq.schema_version&limit=1',
  );
  if (versionProbe.response.ok && Array.isArray(versionProbe.json) && versionProbe.json[0]?.value) {
    installedVersion = String(versionProbe.json[0].value);
  }

  const structureOk = missing.length === 0;
  const versionOk = installedVersion === EXTENSION_SCHEMA_VERSION;
  const ready = structureOk && versionOk;

  let message;
  if (ready) {
    message = `Databáze je připravená (schéma v${EXTENSION_SCHEMA_VERSION}).`;
  } else if (structureOk && !installedVersion) {
    message = `Struktura vypadá v pořádku, ale chybí značka verze. Spusťte „Nainstalovat / aktualizovat“ (doplní schema_version).`;
  } else if (structureOk && !versionOk) {
    message = `Struktura existuje, ale verze schématu je ${installedVersion || '?'} (doplněk očekává ${EXTENSION_SCHEMA_VERSION}). Spusťte aktualizaci.`;
  } else {
    message = `Chybí: ${missing.join(', ')}. Spusťte instalaci databáze.`;
  }

  return {
    ready,
    structureOk,
    versionOk,
    expectedVersion: EXTENSION_SCHEMA_VERSION,
    installedVersion,
    missing,
    present,
    message,
  };
}

async function loadSupabaseInstallSql() {
  const chunks = [];
  for (const file of SUPABASE_INSTALL_SQL_FILES) {
    const response = await fetch(chrome.runtime.getURL(file));
    if (!response.ok) {
      throw new Error(`Nepodařilo se načíst ${file}.`);
    }
    const text = (await response.text()).trim();
    chunks.push(`-- ===== ${file} =====\n${text}`);
  }
  return `${chunks.join('\n\n')}\n`;
}

async function prepareSupabaseInstall(override = null) {
  const { projectRef } = await resolveSupabaseSettings(override);
  const check = await checkSupabaseSchema(override);
  const sql = await loadSupabaseInstallSql();
  const editorUrl = `https://supabase.com/dashboard/project/${encodeURIComponent(projectRef)}/sql/new`;
  return {
    ...check,
    sql,
    editorUrl,
    fileCount: SUPABASE_INSTALL_SQL_FILES.length,
    needsInstall: !check.ready,
  };
}

async function listSupabaseWords() {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  const baseUrl = String(settings.supabaseUrl || '').replace(/\/$/, '');
  const apiKey = String(settings.supabaseKey || '').trim();
  if (!baseUrl || !apiKey) {
    throw new Error('Nejdříve vyplňte Supabase URL a klíč v nastavení.');
  }

  const language = encodeURIComponent(settings.language || 'en');
  const url = `${baseUrl}/rest/v1/words?select=word,view_count,status,translation,language,lingq_card_id,importance,popularity,import_note,created_at,updated_at&language=eq.${language}&order=word.asc&limit=2000`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase odpovědělo chybou (${response.status}).`);
  }

  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

async function deleteWordEverywhere(word, cardId = null) {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  const original = String(word || '').trim();
  const text = normalizeWord(original);
  if (!text) {
    throw new Error('Chybí slovíčko ke smazání.');
  }
  if (!settings.apiKey) {
    throw new Error('Nejdříve zadejte LingQ API klíč v nastavení doplňku.');
  }

  let resolvedCardId = cardId ? String(cardId) : null;
  let lingqDeleted = false;

  // Nejdřív LingQ — při chybě API DB nemažeme.
  if (resolvedCardId) {
    lingqDeleted = await deleteLingqCard(resolvedCardId, settings);
  }

  if (!lingqDeleted) {
    const card = await findCard(text, settings).catch(() => null);
    const foundId = card?.pk ?? card?.id ?? null;
    if (foundId != null) {
      resolvedCardId = String(foundId);
      lingqDeleted = await deleteLingqCard(resolvedCardId, settings);
    }
  }

  // Known words často nejsou v cards search — založit kartu a hned smazat ji odstraní i z LingQ.
  if (!lingqDeleted && await isKnownWord(text, settings).catch(() => false)) {
    const created = await createCard(text, text, settings);
    const createdId = created?.pk ?? created?.id ?? null;
    if (createdId == null) {
      throw new Error('LingQ nevrátil identifikátor karty při mazání known word.');
    }
    resolvedCardId = String(createdId);
    lingqDeleted = await deleteLingqCard(resolvedCardId, settings);
    if (!lingqDeleted) {
      throw new Error('Slovíčko se v LingQ nepodařilo odstranit.');
    }
  }

  if (!lingqDeleted) {
    const stillThere = await findCard(text, settings).catch(() => null);
    if (stillThere) {
      throw new Error('Slovíčko se v LingQ nepodařilo odstranit.');
    }
  }

  forgetKnownWord(text, settings);
  await deleteSupabaseWord(original, settings);

  // Sem se dostaneme jen když je slovíčko v LingQ pryč (smazané nebo ověřeně nepřítomné).
  return {
    word: original,
    cardId: resolvedCardId,
    lingqDeleted: true,
    dbDeleted: true,
  };
}

async function deleteLingqCard(cardId, settings) {
  const language = encodeURIComponent(settings.language);
  const urls = [
    `https://www.lingq.com/api/v3/${language}/cards/${encodeURIComponent(cardId)}/`,
    `https://www.lingq.com/api/v2/${language}/cards/${encodeURIComponent(cardId)}/`,
  ];

  let lastStatus = 0;
  for (const url of urls) {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Token ${settings.apiKey}`,
        Accept: 'application/json',
      },
    });

    // LingQ typicky odpovídá 204 No Content.
    if (response.ok || response.status === 204) {
      return true;
    }
    lastStatus = response.status;
    if (response.status === 401 || response.status === 403) {
      throw new Error('LingQ API klíč není platný nebo nemá potřebná oprávnění.');
    }
    // 404 / jiná chyba — zkusíme ještě v2.
  }

  if (lastStatus === 404) {
    return false;
  }
  throw new Error(`LingQ API neodstranilo kartu (${lastStatus || 'neznámá chyba'}).`);
}

async function deleteSupabaseWord(word, settings) {
  const baseUrl = String(settings.supabaseUrl || '').replace(/\/$/, '');
  const apiKey = String(settings.supabaseKey || '').trim();
  if (!baseUrl || !apiKey) {
    throw new Error('Nejdříve vyplňte Supabase URL a klíč v nastavení.');
  }

  const language = encodeURIComponent(settings.language || 'en');
  const raw = String(word || '').trim();
  const variants = [...new Set([raw, raw.toLowerCase()].filter(Boolean))];
  for (const variant of variants) {
    const url = `${baseUrl}/rest/v1/words?language=eq.${language}&word=eq.${encodeURIComponent(variant)}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        Prefer: 'return=minimal',
      },
    });
    if (!response.ok) {
      throw new Error(`Supabase neodstranilo slovíčko (${response.status}).`);
    }
  }
}

function getStatsPeriodRange(period) {
  const now = new Date();
  const end = now;
  const start = new Date(now);

  if (period === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'quarter') {
    start.setMonth(start.getMonth() - 3);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'half') {
    start.setMonth(start.getMonth() - 6);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'year') {
    start.setFullYear(start.getFullYear() - 1);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
  }

  return { from: start.toISOString(), to: end.toISOString(), start, end };
}

async function getUsageStats(period = '30d') {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  const baseUrl = String(settings.supabaseUrl || '').replace(/\/$/, '');
  const apiKey = String(settings.supabaseKey || '').trim();
  if (!baseUrl || !apiKey) {
    throw new Error('Nejdříve vyplňte Supabase URL a klíč v nastavení.');
  }

  const range = getStatsPeriodRange(period);
  const response = await fetch(`${baseUrl}/rest/v1/rpc/get_usage_stats`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_language: settings.language || 'en',
      p_from: range.from,
      p_to: range.to,
    }),
  });

  if (!response.ok) {
    throw new Error(`Supabase odpovědělo chybou (${response.status}).`);
  }

  const stats = await response.json();
  return {
    ...stats,
    period,
    rangeStart: range.from,
    rangeEnd: range.to,
  };
}

async function getLatencyStats() {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  const baseUrl = String(settings.supabaseUrl || '').replace(/\/$/, '');
  const apiKey = String(settings.supabaseKey || '').trim();
  if (!baseUrl || !apiKey) {
    throw new Error('Nejdříve vyplňte Supabase URL a klíč v nastavení.');
  }

  const range = getLatencyWeekRange();
  const latency = await fetchLatencySummary(settings, range);
  if (!latency.error) {
    latency.week = await fetchLatencyWeekSeries(settings).catch(() => null);
  }
  return latency;
}

function normalizeIdleRange(settings = {}) {
  let min = Number(settings.latencyIdleMinSeconds);
  let max = Number(settings.latencyIdleMaxSeconds);
  if (!Number.isFinite(min) && Number.isFinite(Number(settings.latencyIdleSeconds))) {
    min = Number(settings.latencyIdleSeconds);
  }
  if (!Number.isFinite(max) && Number.isFinite(min)) {
    max = min + 20;
  }
  if (!Number.isFinite(min)) {
    min = 60;
  }
  if (!Number.isFinite(max)) {
    max = 80;
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

function randomIdleSeconds(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function noteUserActivity() {
  try {
    await scheduleNextProbe({ fromNow: true });
  } catch {
    // Sledování odezvy nesmí shodit překlad.
  }
}

async function ensureLatencyWatch(options = {}) {
  const settings = await chrome.storage.sync.get({ ...DEFAULTS, latencyIdleSeconds: 60 });
  if (settings.enabled === false || !isSupabaseConfigured(settings)) {
    await chrome.alarms.clear(LATENCY_ALARM);
    return;
  }
  const gate = await getSupabaseGate().catch(() => ({ ready: false }));
  if (!gate.ready) {
    await chrome.alarms.clear(LATENCY_ALARM);
    return;
  }
  const stored = await chrome.storage.session.get('latencyNextProbeAt');
  if (options.reshuffle || !stored.latencyNextProbeAt) {
    await scheduleNextProbe({ fromNow: true });
    return;
  }
  await armLatencyAlarm(Number(stored.latencyNextProbeAt));
}

async function scheduleNextProbe({ fromNow = true } = {}) {
  const settings = await chrome.storage.sync.get({ ...DEFAULTS, latencyIdleSeconds: 60 });
  if (settings.enabled === false || !isSupabaseConfigured(settings)) {
    await chrome.alarms.clear(LATENCY_ALARM);
    return;
  }
  const gate = await getSupabaseGate().catch(() => ({ ready: false }));
  if (!gate.ready) {
    await chrome.alarms.clear(LATENCY_ALARM);
    return;
  }
  const { min, max } = normalizeIdleRange(settings);
  const delaySec = randomIdleSeconds(min, max);
  const nextProbeAt = Date.now() + delaySec * 1000;
  await chrome.storage.session.set({
    latencyNextProbeAt: nextProbeAt,
    latencyNextDelaySec: delaySec,
  });
  await armLatencyAlarm(nextProbeAt);
}

async function armLatencyAlarm(nextProbeAt) {
  const delayMs = Math.max(Number(nextProbeAt) - Date.now(), 30000);
  await chrome.alarms.create(LATENCY_ALARM, { delayInMinutes: delayMs / 60000 });
}

async function onLatencyAlarm() {
  const settings = await chrome.storage.sync.get({ ...DEFAULTS, latencyIdleSeconds: 60 });
  if (settings.enabled === false || !isSupabaseConfigured(settings)) {
    return;
  }
  const gate = await getSupabaseGate().catch(() => ({ ready: false }));
  if (!gate.ready) {
    return;
  }
  const stored = await chrome.storage.session.get('latencyNextProbeAt');
  const nextProbeAt = Number(stored.latencyNextProbeAt) || 0;
  if (nextProbeAt && Date.now() + 2000 < nextProbeAt) {
    await armLatencyAlarm(nextProbeAt);
    return;
  }
  if (activeUserLookups > 0) {
    await scheduleNextProbe({ fromNow: true });
    return;
  }
  try {
    await probeLingq();
  } finally {
    await scheduleNextProbe({ fromNow: true });
  }
}

async function probeLingq() {
  const probeWord = await pickProbeWordFromDatabase();
  const startedAt = Date.now();
  try {
    const result = await lookupWord(probeWord, { probe: true });
    await recordLatency({
      source: 'probe',
      word: result.word || probeWord,
      wordStatus: latencyWordStatus(result),
      durationMs: Date.now() - startedAt,
      ok: true,
    });
  } catch (error) {
    await recordLatency({
      source: 'probe',
      word: probeWord,
      durationMs: Date.now() - startedAt,
      ok: false,
      error: getErrorMessage(error),
    });
  }
}

async function pickProbeWordFromDatabase() {
  try {
    const settings = await chrome.storage.sync.get(DEFAULTS);
    const baseUrl = String(settings.supabaseUrl || '').replace(/\/$/, '');
    const apiKey = String(settings.supabaseKey || '').trim();
    if (!baseUrl || !apiKey) {
      return PROBE_FALLBACK_WORD;
    }

    const countParams = new URLSearchParams({
      select: 'word',
      language: `eq.${PROBE_LANGUAGE}`,
    });
    const countResponse = await fetch(`${baseUrl}/rest/v1/words?${countParams}`, {
      method: 'HEAD',
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        Prefer: 'count=exact',
      },
    });
    const contentRange = countResponse.headers.get('content-range') || '';
    const total = Number((contentRange.match(/\/(\d+)$/) || [])[1]);
    if (!Number.isFinite(total) || total <= 0) {
      return PROBE_FALLBACK_WORD;
    }

    const offset = Math.floor(Math.random() * total);
    const rowParams = new URLSearchParams({
      select: 'word',
      language: `eq.${PROBE_LANGUAGE}`,
      order: 'id.asc',
      limit: '1',
      offset: String(offset),
    });
    const rowResponse = await fetch(`${baseUrl}/rest/v1/words?${rowParams}`, {
      method: 'GET',
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        Range: `${offset}-${offset}`,
      },
    });
    if (!rowResponse.ok) {
      return PROBE_FALLBACK_WORD;
    }
    const rows = await rowResponse.json();
    const word = normalizeWord(rows?.[0]?.word).toLowerCase();
    return word || PROBE_FALLBACK_WORD;
  } catch {
    return PROBE_FALLBACK_WORD;
  }
}

function latencySourceKind(source) {
  if (source === 'phrase') {
    return 'phrase';
  }
  if (source === 'probe' || source === 'idle') {
    return 'idle';
  }
  return 'click';
}

function latencyWordStatus(result) {
  if (!result) {
    return null;
  }
  if (result.created === true) {
    return 'new';
  }
  const status = Number(result.status);
  if (status === 5) {
    return 'K';
  }
  if (Number.isInteger(status) && status >= 1 && status <= 4) {
    return String(status);
  }
  if (result.unknown === true) {
    return 'new';
  }
  return null;
}

async function recordLatency(sample) {
  try {
    const settings = await chrome.storage.sync.get(DEFAULTS);
    if (!isSupabaseConfigured(settings)) {
      return;
    }
    const gate = await getSupabaseGate();
    if (!gate.ready) {
      return;
    }
    const baseUrl = String(settings.supabaseUrl || '').replace(/\/$/, '');
    const apiKey = String(settings.supabaseKey || '').trim();
    const payload = {
      kind: latencySourceKind(sample.source),
      word: String(sample.word || '').replace(/\s+/g, ' ').trim().slice(0, 200).toLowerCase(),
      language: sample.language || settings.language || 'en',
      duration_ms: Math.max(0, Math.round(Number(sample.durationMs) || 0)),
      ok: sample.ok !== false,
      error: sample.ok === false ? String(sample.error || '').slice(0, 300) : null,
    };
    if (sample.wordStatus) {
      payload.word_status = sample.wordStatus;
    }
    await fetch(`${baseUrl}/rest/v1/lingq_latency`, {
      method: 'POST',
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Měření nesmí rozbít překlad slova.
  }
}

async function logUsageEvent(eventType, fields = {}) {
  try {
    const settings = await chrome.storage.sync.get(DEFAULTS);
    if (!isSupabaseConfigured(settings)) {
      return;
    }
    const gate = await getSupabaseGate();
    if (!gate.ready) {
      return;
    }
    const baseUrl = String(settings.supabaseUrl || '').replace(/\/$/, '');
    const apiKey = String(settings.supabaseKey || '').trim();
    await fetch(`${baseUrl}/rest/v1/usage_events`, {
      method: 'POST',
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        event_type: eventType,
        word: String(fields.word || '').replace(/\s+/g, ' ').trim().slice(0, 200) || null,
        language: settings.language || 'en',
        status: Number.isInteger(Number(fields.status)) ? Number(fields.status) : null,
      }),
    });
  } catch {
    // Statistiky nesmí shodit překlad.
  }
}

async function fetchLatencySummary(settings, range) {
  const baseUrl = String(settings.supabaseUrl || '').replace(/\/$/, '');
  const apiKey = String(settings.supabaseKey || '').trim();
  if (!baseUrl || !apiKey) {
    return { error: 'Nejdříve vyplňte Supabase URL a klíč v nastavení.' };
  }

  const params = new URLSearchParams({
    select: 'duration_ms,kind,ok,created_at,word_status',
    language: `eq.${settings.language || 'en'}`,
    order: 'created_at.desc',
    limit: '5000',
  });
  params.append('created_at', `gte.${range.from}`);
  params.append('created_at', `lt.${range.to}`);
  const response = await fetch(`${baseUrl}/rest/v1/lingq_latency?${params}`, {
    method: 'GET',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return { error: 'V databázi chybí tabulka lingq_latency. Spusťte supabase/latency.sql.' };
    }
    throw new Error(`Supabase odpovědělo chybou (${response.status}).`);
  }

  const rows = await response.json();
  return summarizeLatency(Array.isArray(rows) ? rows : []);
}

function latencyKindOf(row) {
  if (row.kind === 'phrase') {
    return 'phrase';
  }
  if (row.kind === 'idle' || row.source === 'probe') {
    return 'idle';
  }
  return 'click';
}

function getLatencyWeekRange() {
  const end = new Date();
  const start = new Date(end);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  return { from: start.toISOString(), to: end.toISOString(), start, end };
}

async function fetchLatencyWeekSeries(settings) {
  const baseUrl = String(settings.supabaseUrl || '').replace(/\/$/, '');
  const apiKey = String(settings.supabaseKey || '').trim();
  if (!baseUrl || !apiKey) {
    return null;
  }

  const range = getLatencyWeekRange();
  const params = new URLSearchParams({
    select: 'duration_ms,kind,ok,created_at,word_status',
    language: `eq.${settings.language || 'en'}`,
    order: 'created_at.asc',
    limit: '20000',
  });
  params.append('created_at', `gte.${range.from}`);
  params.append('created_at', `lt.${range.to}`);
  const response = await fetch(`${baseUrl}/rest/v1/lingq_latency?${params}`, {
    method: 'GET',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      Prefer: 'count=exact',
    },
  });

  if (!response.ok) {
    return null;
  }

  const rows = await response.json();
  return buildLatencyWeekSeries(Array.isArray(rows) ? rows : [], range);
}

function buildLatencyWeekSeries(rows, range) {
  const click = [];
  const idle = [];
  const phrase = [];
  rows.forEach((row) => {
    if (row.ok === false) {
      return;
    }
    const at = Date.parse(row.created_at);
    const ms = Number(row.duration_ms);
    if (!Number.isFinite(at) || !Number.isFinite(ms)) {
      return;
    }
    const point = { t: at, ms: Math.max(0, Math.round(ms)) };
    const kind = latencyKindOf(row);
    if (kind === 'idle') {
      idle.push(point);
    } else if (kind === 'phrase') {
      phrase.push(point);
    } else {
      click.push(point);
    }
  });
  return {
    from: range.from,
    to: range.to,
    click,
    idle,
    phrase,
  };
}

function summarizeLatency(rows) {
  const average = (list) => (
    list.length
      ? Math.round(list.reduce((sum, row) => sum + Number(row.duration_ms || 0), 0) / list.length)
      : null
  );
  const successful = rows.filter((row) => row.ok !== false);
  const clicks = successful.filter((row) => latencyKindOf(row) === 'click');
  const probes = successful.filter((row) => latencyKindOf(row) === 'idle');
  const phrases = successful.filter((row) => latencyKindOf(row) === 'phrase');
  const last = rows[0] || null;
  const statusOrder = ['new', '1', '2', '3', '4', 'K'];
  const byStatus = {};
  statusOrder.forEach((key) => {
    const list = clicks.filter((row) => row.word_status === key);
    byStatus[key] = {
      count: list.length,
      avgMs: average(list),
    };
  });
  return {
    count: rows.length,
    okCount: successful.length,
    failCount: rows.length - successful.length,
    avgMs: average(successful),
    clickAvgMs: average(clicks),
    probeAvgMs: average(probes),
    phraseAvgMs: average(phrases),
    clickCount: clicks.length,
    probeCount: probes.length,
    phraseCount: phrases.length,
    byStatus,
    lastMs: last ? Number(last.duration_ms) : null,
    lastSource: last ? latencyKindOf(last) : null,
    lastOk: last ? last.ok !== false : null,
  };
}

async function syncSupabaseWord(rpcName, fields, settings) {
  const baseUrl = String(settings.supabaseUrl || '').replace(/\/$/, '');
  const apiKey = String(settings.supabaseKey || '').trim();
  if (!baseUrl || !apiKey) {
    return null;
  }
  const gate = await getSupabaseGate();
  if (!gate.ready) {
    return null;
  }

  const payload = {
    p_word: normalizeWord(fields.word),
    p_language: settings.language || 'en',
  };
  if (fields.translation != null && String(fields.translation).trim()) {
    payload.p_translation = String(fields.translation).trim();
  }
  if (Number.isInteger(Number(fields.status))) {
    payload.p_status = Number(fields.status);
  }
  if (fields.cardId != null && fields.cardId !== '') {
    const cardId = Number(fields.cardId);
    if (Number.isFinite(cardId)) {
      payload.p_lingq_card_id = cardId;
    }
  }

  const response = await fetch(`${baseUrl}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Supabase odpovědělo chybou (${response.status}).`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
