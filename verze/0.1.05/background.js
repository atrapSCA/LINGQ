const DEFAULTS = {
  apiKey: 'd59c2650c569e8f6aba883b9d4fb48826d1b1d25',
  language: 'en',
  targetLanguage: 'cs',
  enabled: true,
};

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
  });
});

chrome.runtime.onStartup.addListener(syncActionIcon);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.enabled) {
    applyActionIcon(changes.enabled.newValue);
  }
});
syncActionIcon();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'LOOKUP_WORD') {
    lookupWord(message.word)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === 'UPDATE_STATUS') {
    updateStatus(message.cardId, message.status)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === 'UPDATE_TRANSLATION') {
    updateTranslation(message.cardId, message.word, message.translation)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === 'TRANSLATE_PHRASE') {
    translatePhrase(message.text)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  return false;
});

async function lookupWord(word) {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  if (!settings.apiKey) {
    throw new Error('Nejdříve zadejte LingQ API klíč v nastavení doplňku.');
  }

  const cleanWord = normalizeWord(word);
  const card = await findCard(cleanWord, settings);
  const cardStatus = card ? normalizeStatus(card.status, card.extended_status) : 0;

  if (card && cardStatus > 1) {
    return cardResult(cleanWord, card, settings);
  }

  if (await isKnownWord(cleanWord, settings)) {
    const hint = await findHint(cleanWord, settings).catch(() => null);
    const translations = extractTranslations(card?.hints || hint, settings.targetLanguage);
    let cardId = card?.pk ?? card?.id ?? null;
    if (cardId && cardStatus !== 5) {
      try {
        const updated = await updateStatus(cardId, 5);
        cardId = updated.cardId ?? cardId;
      } catch {
        // V bublině zůstane K, i když se stav karty nepodaří hned srovnat.
      }
    }
    return {
      word: cleanWord,
      translation: translations[0] || 'Překlad není k dispozici.',
      translations,
      status: 5,
      cardId,
      created: false,
      unknown: false,
    };
  }

  if (card) {
    return cardResult(cleanWord, card, settings);
  }

  const hint = await findHint(cleanWord, settings);
  const translations = extractTranslations(hint, settings.targetLanguage);
  const translation = translations[0] || 'Překlad nebyl nalezen.';
  const createdCard = await createCard(cleanWord, translation, settings);

  return {
    word: cleanWord,
    translation,
    translations,
    status: normalizeStatus(createdCard?.status ?? 0, createdCard?.extended_status),
    cardId: createdCard?.pk ?? createdCard?.id,
    created: true,
    unknown: true,
  };
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

async function updateStatus(cardId, status) {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  if (!settings.apiKey || !cardId) {
    throw new Error('Tuto kartu nelze aktualizovat.');
  }
  const { apiStatus, body } = toApiStatus(status);
  const url = `${getApiBase(settings)}/cards/${encodeURIComponent(cardId)}/`;
  const response = await lingqRequest(url, settings, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return {
    status: normalizeStatus(response?.status ?? apiStatus, response?.extended_status ?? body.extended_status),
    cardId,
  };
}

async function updateTranslation(cardId, word, translation) {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  const text = String(translation || '').replace(/\s+/g, ' ').trim();
  if (!settings.apiKey || !cardId) {
    throw new Error('Tuto kartu nelze aktualizovat.');
  }
  if (!text) {
    throw new Error('Překlad nemůže být prázdný.');
  }

  const cardUrl = `${getApiBase(settings)}/cards/${encodeURIComponent(cardId)}/`;
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
    return { translation: text };
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
  return { translation: text };
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
    `search=${encodeURIComponent(word)}&search_criteria=exact&page_size=20&status=0&status=1&status=2&status=3`,
    `search=${encodeURIComponent(word)}&page_size=50&status=0&status=1&status=2&status=3`,
  ];

  for (const query of queries) {
    try {
      const response = await lingqRequest(`${getApiBase(settings)}/cards/?${query}`, settings, { method: 'GET' });
      const match = bestCard(listResults(response), word);
      if (match) {
        return match;
      }
    } catch {
      // Další tvar dotazu zkusí stejné slovo jiným filtrem.
    }
  }

  return null;
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

async function isKnownWord(word, settings) {
  const language = encodeURIComponent(settings.language);
  const encoded = encodeURIComponent(word);
  const urls = [
    `https://www.lingq.com/api/v3/${language}/known-words/?search=${encoded}&page_size=20`,
    `https://www.lingq.com/api/v2/${language}/known-words/?search=${encoded}&page_size=20`,
  ];

  for (const url of urls) {
    try {
      const response = await lingqRequest(url, settings, { method: 'GET' });
      if (responseContainsWord(response, word)) {
        return true;
      }
    } catch {
      // Známá slova jsou v jiném endpointu podle verze API.
    }
  }

  return false;
}

function responseContainsWord(response, word) {
  const target = word.toLowerCase();
  const items = listResults(response);
  const pool = items.length > 0 ? items : (Array.isArray(response) ? response : []);
  const texts = pool.map(knownItemText).filter(Boolean);
  if (!texts.includes(target)) {
    return false;
  }
  return texts.every((text) => text === target || text.startsWith(target));
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
