importScripts('role.js', 'sites.js', 'defaults.js', 'i18n.js');

async function ensureBgLocale() {
  if (typeof LingqI18n === 'undefined') {
    return;
  }
  const stored = await chrome.storage.sync.get({ uiLocale: LingqI18n.DEFAULT });
  await LingqI18n.setLocale(stored.uiLocale || LingqI18n.DEFAULT, { apply: false });
}

function bt(key, vars) {
  return typeof LingqI18n !== 'undefined' ? LingqI18n.t(key, vars) : key;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.uiLocale && typeof LingqI18n !== 'undefined') {
    LingqI18n.setLocale(changes.uiLocale.newValue || LingqI18n.DEFAULT, { apply: false }).catch(() => {});
  }
});

const LATENCY_ALARM = 'lingq-latency-watch';
const UPDATE_CHECK_ALARM = 'lingq-github-update-check';
const IMPORT_CONTINUE_ALARM = 'importContinue';
const GITHUB_REPO = 'atrapSCA/LINGQ';
const GITHUB_TAGS_URL = `https://api.github.com/repos/${GITHUB_REPO}/tags?per_page=20`;
const UPDATE_CHECK_PERIOD_MINUTES = 6 * 60;
const UPDATE_STATUS_KEY = 'githubUpdateStatus';
const PROBE_FALLBACK_WORD = 'the';
const PROBE_LANGUAGE = 'en';
const APP_PAGE = 'app.html';
const EXTENSION_ORIGIN = `chrome-extension://${chrome.runtime.id}/`;
const CONTENT_ONLY_MESSAGES = new Set([
  'LOOKUP_WORD',
  'TRANSLATE_PHRASE',
  'UPDATE_STATUS',
  'GET_ALTERNATIVES',
  'GET_HIGHLIGHT_MAP',
]);
/** Povoleno z content scriptu i ze stránky doplňku (slovník v app.html). */
const SHARED_MESSAGES = new Set([
  'UPDATE_TRANSLATION',
]);
const EXTENSION_ONLY_MESSAGES = new Set([
  'OPEN_APP',
  'APP_OPENED',
  'SYNC_DB_TO_LINGQ',
  'GET_LINGQ_SYNC_STATUS',
  'VALIDATE_CHATGPT_KEY',
  'GET_SUPABASE_STATUS',
  'COUNT_SUPABASE_WORDS',
  'LIST_SUPABASE_WORDS_FILTER',
  'LIST_SUPABASE_WORDS_PAGE',
  'CHECK_SUPABASE_SCHEMA',
  'PREPARE_SUPABASE_INSTALL',
  'DELETE_WORD',
  'SYNC_KNOWN_WORDS',
  'GET_KNOWN_WORDS_SYNC_STATUS',
  'RESET_LINGQ_IMPORT_PROGRESS',
  'GET_USAGE_STATS',
  'GET_LATENCY_STATS',
  'GET_UPDATE_STATUS',
  'CHECK_FOR_UPDATE',
  'DISMISS_UPDATE',
]);
const ENABLED_GATED_MESSAGES = new Set([
  'LOOKUP_WORD',
  'TRANSLATE_PHRASE',
  'UPDATE_STATUS',
  'UPDATE_TRANSLATION',
  'GET_ALTERNATIVES',
]);
/** Limity jsou vysoko nad běžným používáním; brání spam ze stránky. */
const MESSAGE_RATE_LIMITS = {
  LOOKUP_WORD: { windowMs: 60_000, max: 45 },
  TRANSLATE_PHRASE: { windowMs: 60_000, max: 25 },
  GET_ALTERNATIVES: { windowMs: 60_000, max: 30 },
  UPDATE_STATUS: { windowMs: 60_000, max: 60 },
  UPDATE_TRANSLATION: { windowMs: 60_000, max: 60 },
  GET_HIGHLIGHT_MAP: { windowMs: 60_000, max: 60 },
};

const highlightNavNotifyAt = new Map();

function notifyTabHighlightNavigation(tabId, url) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    return;
  }
  const now = Date.now();
  const previous = highlightNavNotifyAt.get(tabId) || 0;
  if (now - previous < 350) {
    return;
  }
  highlightNavNotifyAt.set(tabId, now);
  chrome.tabs.sendMessage(tabId, {
    type: 'HIGHLIGHT_PAGE_CHANGED',
    url: String(url || ''),
  }).catch(() => {
    // Content script na stránce ještě není / neposlouchá.
  });
}

if (chrome.webNavigation?.onHistoryStateUpdated) {
  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId !== 0) {
      return;
    }
    notifyTabHighlightNavigation(details.tabId, details.url);
  });
}
const rateLimitBuckets = new Map();
let activeUserLookups = 0;
let appTabId = null;
let knownWordsFetchPromise = null;
let highlightMapCache = {
  language: '',
  at: 0,
  words: null,
};
const HIGHLIGHT_MAP_TTL_MS = 5 * 60 * 1000;
const HIGHLIGHT_MAP_PAGE_SIZE = 1000;
const HIGHLIGHT_MAP_MAX_PAGES = 250;

function invalidateHighlightMapCache() {
  highlightMapCache = { language: '', at: 0, words: null };
}

function isExtensionPageSender(sender) {
  const url = String(sender?.url || sender?.tab?.url || '');
  return url.startsWith(EXTENSION_ORIGIN);
}

function isContentScriptSender(sender) {
  if (!Number.isInteger(sender?.tab?.id)) {
    return false;
  }
  return !isExtensionPageSender(sender);
}

function authorizeMessage(type, sender) {
  if (!type || typeof type !== 'string') {
    return false;
  }
  if (CONTENT_ONLY_MESSAGES.has(type)) {
    return isContentScriptSender(sender);
  }
  if (EXTENSION_ONLY_MESSAGES.has(type)) {
    return isExtensionPageSender(sender);
  }
  if (SHARED_MESSAGES.has(type) || type === 'NOTE_ACTIVITY') {
    return isContentScriptSender(sender) || isExtensionPageSender(sender);
  }
  return false;
}

function consumeRateLimit(type, sender) {
  const config = MESSAGE_RATE_LIMITS[type];
  if (!config) {
    return true;
  }
  const key = `${type}:${sender?.tab?.id ?? 'ext'}`;
  const now = Date.now();
  const stamps = (rateLimitBuckets.get(key) || []).filter((ts) => now - ts < config.windowMs);
  if (stamps.length >= config.max) {
    rateLimitBuckets.set(key, stamps);
    return false;
  }
  stamps.push(now);
  rateLimitBuckets.set(key, stamps);
  return true;
}

function gateUserAction(type, sender, sendResponse, run) {
  chrome.storage.sync.get({ enabledSites: [] }, (settings) => {
    const tabUrl = sender?.tab?.url || sender?.url || '';
    const host = typeof LingqSites !== 'undefined'
      ? LingqSites.siteKeyFromUrl(tabUrl)
      : '';
    // Požadavky z content scriptu musí být z povoleného webu; app/popup neblokovat.
    const fromContent = Boolean(sender?.tab?.id);
    if (fromContent && host && !LingqSites.isHostEnabled(host, settings.enabledSites)) {
      sendResponse({ ok: false, error: bt('err.extensionOff') });
      return;
    }
    if (fromContent && !host) {
      sendResponse({ ok: false, error: bt('err.extensionOff') });
      return;
    }
    if (!consumeRateLimit(type, sender)) {
      sendResponse({ ok: false, error: bt('err.rateLimited') });
      return;
    }
    run();
  });
}

function iconPaths(enabled) {
  const state = enabled ? 'on' : 'off';
  return {
    16: `icons/${state}-16.png`,
    32: `icons/${state}-32.png`,
    48: `icons/${state}-48.png`,
    128: `icons/${state}-128.png`,
  };
}

async function applyActionIcon(enabled, { tabId } = {}) {
  const isEnabled = enabled !== false;
  const paths = iconPaths(isEnabled);
  if (Number.isInteger(tabId)) {
    chrome.action.setIcon({ path: paths, tabId });
  } else {
    chrome.action.setIcon({ path: paths });
  }
  await ensureBgLocale();
  const title = isEnabled ? bt('action.titleOn') : bt('action.titleOff');
  if (Number.isInteger(tabId)) {
    chrome.action.setTitle({ title, tabId });
  } else {
    chrome.action.setTitle({ title });
  }
}

async function syncActionIconForTab(tabId, url) {
  const settings = await chrome.storage.sync.get({ enabledSites: [] });
  const host = typeof LingqSites !== 'undefined' ? LingqSites.siteKeyFromUrl(url || '') : '';
  const on = Boolean(host) && LingqSites.isHostEnabled(host, settings.enabledSites);
  await applyActionIcon(on, { tabId });
}

async function syncActionIcon() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0];
    if (tab?.id != null) {
      await syncActionIconForTab(tab.id, tab.url || '');
    } else {
      await applyActionIcon(false);
    }
  } catch {
    await applyActionIcon(false);
  }
  getStoredUpdateStatus()
    .then((status) => applyUpdateBadge(status))
    .catch(() => {});
}

function getInstalledExtensionVersion() {
  return String(chrome.runtime.getManifest()?.version || '').trim();
}

function normalizeVersionTag(value) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
    .replace(/[^0-9.].*$/, '');
}

function parseVersionParts(version) {
  return normalizeVersionTag(version)
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

function compareVersions(left, right) {
  const a = parseVersionParts(left);
  const b = parseVersionParts(right);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }
  return 0;
}

function defaultUpdateStatus() {
  return {
    updateAvailable: false,
    currentVersion: getInstalledExtensionVersion(),
    latestVersion: null,
    releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
    checkedAt: null,
    dismissedVersion: null,
    error: null,
  };
}

async function getStoredUpdateStatus() {
  const stored = await chrome.storage.local.get(UPDATE_STATUS_KEY);
  const raw = stored[UPDATE_STATUS_KEY];
  const base = defaultUpdateStatus();
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  const latestVersion = raw.latestVersion ? normalizeVersionTag(raw.latestVersion) : null;
  const dismissedVersion = raw.dismissedVersion ? normalizeVersionTag(raw.dismissedVersion) : null;
  const currentVersion = getInstalledExtensionVersion();
  const newer = Boolean(latestVersion && compareVersions(latestVersion, currentVersion) > 0);
  const dismissed = Boolean(dismissedVersion && latestVersion && dismissedVersion === latestVersion);
  return {
    ...base,
    ...raw,
    currentVersion,
    latestVersion,
    dismissedVersion,
    updateAvailable: newer && !dismissed,
    releaseUrl: raw.releaseUrl || (latestVersion
      ? `https://github.com/${GITHUB_REPO}/releases/tag/v${latestVersion}`
      : base.releaseUrl),
  };
}

async function saveUpdateStatus(status) {
  await chrome.storage.local.set({ [UPDATE_STATUS_KEY]: status });
  await applyUpdateBadge(status);
  return status;
}

async function applyUpdateBadge(status) {
  if (status?.updateAvailable) {
    await chrome.action.setBadgeText({ text: '↑' });
    await chrome.action.setBadgeBackgroundColor({ color: '#1f7f68' });
    return;
  }
  await chrome.action.setBadgeText({ text: '' });
}

async function ensureUpdateCheckSchedule() {
  try {
    await chrome.alarms.create(UPDATE_CHECK_ALARM, {
      periodInMinutes: UPDATE_CHECK_PERIOD_MINUTES,
      delayInMinutes: 1,
    });
  } catch {
    // Alarm API nemusí být dostupné ve všech kontextech.
  }
}

async function fetchLatestGithubVersion() {
  const response = await fetch(GITHUB_TAGS_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(bt('update.checkFailed', { status: response.status }));
  }
  const tags = await response.json();
  if (!Array.isArray(tags) || tags.length === 0) {
    throw new Error(bt('update.noTags'));
  }
  for (const tag of tags) {
    const name = normalizeVersionTag(tag?.name);
    if (/^\d+\.\d+/.test(name)) {
      return {
        latestVersion: name,
        releaseUrl: `https://github.com/${GITHUB_REPO}/releases/tag/v${name}`,
      };
    }
  }
  throw new Error(bt('update.noTags'));
}

async function checkGithubUpdate({ force = false } = {}) {
  const previous = await getStoredUpdateStatus();
  const now = Date.now();
  const checkedAt = Number(previous.checkedAt) || 0;
  if (!force && checkedAt && now - checkedAt < 60 * 60 * 1000) {
    return previous;
  }

  try {
    const remote = await fetchLatestGithubVersion();
    const currentVersion = getInstalledExtensionVersion();
    const latestVersion = remote.latestVersion;
    const dismissedVersion = previous.dismissedVersion || null;
    const newer = compareVersions(latestVersion, currentVersion) > 0;
    const dismissed = Boolean(dismissedVersion && dismissedVersion === latestVersion);
    const status = {
      updateAvailable: newer && !dismissed,
      currentVersion,
      latestVersion,
      releaseUrl: remote.releaseUrl,
      checkedAt: now,
      dismissedVersion,
      error: null,
    };
    return saveUpdateStatus(status);
  } catch (error) {
    const status = {
      ...previous,
      currentVersion: getInstalledExtensionVersion(),
      checkedAt: now,
      error: error instanceof Error ? error.message : bt('update.checkFailedGeneric'),
    };
    return saveUpdateStatus(status);
  }
}

async function dismissUpdateNotice(version) {
  const previous = await getStoredUpdateStatus();
  const dismissedVersion = normalizeVersionTag(version || previous.latestVersion || '');
  const status = {
    ...previous,
    dismissedVersion: dismissedVersion || previous.dismissedVersion,
    updateAvailable: false,
  };
  if (status.latestVersion && status.dismissedVersion === status.latestVersion) {
    status.updateAvailable = false;
  } else if (status.latestVersion && compareVersions(status.latestVersion, status.currentVersion) > 0) {
    status.updateAvailable = status.dismissedVersion !== status.latestVersion;
  }
  return saveUpdateStatus(status);
}

async function bootstrapExtensionStorage() {
  await migrateSecretsAndLegacy();
  syncActionIcon().catch(() => {});
  ensureLatencyWatch();
  ensureUpdateCheckSchedule();
}

chrome.runtime.onInstalled.addListener(() => {
  bootstrapExtensionStorage()
    .then(() => checkGithubUpdate({ force: true }))
    .catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  bootstrapExtensionStorage()
    .then(() => checkGithubUpdate({ force: false }))
    .catch(() => {});
});

// Migrace i při wake service workeru (upgrade bez reinstall).
migrateSecretsAndLegacy().catch(() => {});

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      return;
    }
    syncActionIconForTab(tab.id, tab.url || '').catch(() => {});
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    syncActionIconForTab(tabId, tab?.url || changeInfo.url || '').catch(() => {});
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.supabaseKey) {
    invalidateSupabaseReadyCache();
    invalidateHighlightMapCache();
    ensureLatencyWatch({ reshuffle: true });
    return;
  }
  if (areaName !== 'sync') {
    return;
  }
  if (changes.enabledSites) {
    syncActionIcon().catch(() => {});
    ensureLatencyWatch({ reshuffle: true });
  }
  if (changes.supabaseUrl || changes.supabaseEnabled) {
    invalidateSupabaseReadyCache();
    invalidateHighlightMapCache();
    ensureLatencyWatch({ reshuffle: true });
  }
  if (changes.language || changes.highlightEnabled) {
    invalidateHighlightMapCache();
  }
  if (changes.lingqEnabled) {
    ensureLatencyWatch({ reshuffle: true });
    const wasOff = changes.lingqEnabled.oldValue === false;
    const isOn = changes.lingqEnabled.newValue !== false;
    if (wasOff && isOn) {
      syncDbToLingq().catch(() => {});
    }
  }
  if (changes.latencyIdleMinSeconds || changes.latencyIdleMaxSeconds) {
    ensureLatencyWatch({ reshuffle: true });
  }
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LATENCY_ALARM) {
    onLatencyAlarm();
  }
  if (alarm.name === UPDATE_CHECK_ALARM) {
    checkGithubUpdate({ force: false }).catch(() => {});
  }
  if (alarm.name === IMPORT_CONTINUE_ALARM) {
    resumeImportIfDue({ reason: 'alarm' }).catch(() => {});
  }
});
syncActionIcon();
ensureLatencyWatch();
ensureUpdateCheckSchedule();
checkGithubUpdate({ force: false }).catch(() => {});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === appTabId) {
    appTabId = null;
  }
});

async function openAppPage() {
  const url = chrome.runtime.getURL(APP_PAGE);
  if (appTabId != null) {
    try {
      const tab = await chrome.tabs.get(appTabId);
      if (tab?.id != null) {
        const update = { active: true };
        if (!String(tab.url || '').startsWith(url)) {
          update.url = url;
        }
        await chrome.tabs.update(tab.id, update);
        if (tab.windowId != null) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
        return { ok: true, reused: true };
      }
    } catch (_error) {
      appTabId = null;
    }
  }

  const tab = await chrome.tabs.create({ url });
  appTabId = tab.id ?? null;
  return { ok: true, reused: false };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;
  if (!authorizeMessage(type, sender)) {
    sendResponse({ ok: false, error: bt('err.denied') });
    return false;
  }

  if (type === 'OPEN_APP') {
    openAppPage()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  if (type === 'SYNC_DB_TO_LINGQ') {
    syncDbToLingq()
      .then((state) => sendResponse({ ok: true, sync: state }))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  if (type === 'GET_LINGQ_SYNC_STATUS') {
    sendResponse({ ok: true, sync: lingqSyncState });
    return false;
  }

  if (type === 'APP_OPENED') {
    if (sender.tab?.id != null) {
      appTabId = sender.tab.id;
    }
    sendResponse({ ok: true });
    return false;
  }

  if (type === 'LOOKUP_WORD') {
    gateUserAction(type, sender, sendResponse, () => {
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
    });
    return true;
  }

  if (type === 'NOTE_ACTIVITY') {
    noteUserActivity();
    return false;
  }

  if (type === 'UPDATE_STATUS') {
    gateUserAction(type, sender, sendResponse, () => {
      noteUserActivity();
      updateStatus(message.cardId, message.status, message.word, message.translation)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    });
    return true;
  }

  if (type === 'UPDATE_TRANSLATION') {
    gateUserAction(type, sender, sendResponse, () => {
      noteUserActivity();
      updateTranslation(message.cardId, message.word, message.translation)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    });
    return true;
  }

  if (type === 'VALIDATE_CHATGPT_KEY') {
    validateChatgptApiKey(message.apiKey)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : bt('err.chatgptValidate') }));
    return true;
  }

  if (type === 'GET_ALTERNATIVES') {
    gateUserAction(type, sender, sendResponse, () => {
      noteUserActivity();
      getAlternativeTranslations(message.word, message.currentTranslation)
        .then((translations) => reply(sendResponse, { ok: true, translations }))
        .catch((error) => reply(sendResponse, { ok: false, error: getErrorMessage(error) }));
    });
    return true;
  }

  if (type === 'GET_HIGHLIGHT_MAP') {
    gateUserAction(type, sender, sendResponse, () => {
      getHighlightWordMap({ force: Boolean(message.force) })
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({
          ok: false,
          words: {},
          error: error instanceof Error ? error.message : bt('err.highlightMap'),
        }));
    });
    return true;
  }

  if (type === 'TRANSLATE_PHRASE') {
    gateUserAction(type, sender, sendResponse, () => {
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
    });
    return true;
  }

  if (type === 'GET_SUPABASE_STATUS') {
    getSupabaseGate({ force: Boolean(message.force) })
      .then((gate) => sendResponse({ ok: true, ...gate }))
      .catch((error) => sendResponse({
        ok: false,
        ready: false,
        configured: false,
        error: error instanceof Error ? error.message : bt('err.dbStatus'),
      }));
    return true;
  }

  if (type === 'COUNT_SUPABASE_WORDS') {
    requireSupabaseReady()
      .then(() => countSupabaseWords())
      .then((total) => sendResponse({ ok: true, total }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : bt('words.loadFailed') }));
    return true;
  }

  if (type === 'LIST_SUPABASE_WORDS_FILTER') {
    requireSupabaseReady()
      .then(() => listSupabaseWordsByFilter(message))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : bt('words.loadFailed') }));
    return true;
  }

  if (type === 'LIST_SUPABASE_WORDS_PAGE') {
    requireSupabaseReady()
      .then(() => listSupabaseWordsPage(message.offset, message.limit))
      .then((page) => sendResponse({ ok: true, ...page }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : bt('words.loadFailed') }));
    return true;
  }

  if (type === 'CHECK_SUPABASE_SCHEMA') {
    checkSupabaseSchema(message.settings || null)
      .then((result) => {
        rememberSupabaseReady(
          result.ready === true,
          message.settings || null,
          result.message,
          result.messageKey,
          result.messageParams,
        );
        ensureLatencyWatch({ reshuffle: true });
        return result;
      })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        const messageText = error instanceof Error ? error.message : bt('settings.dbCheckFailed');
        rememberSupabaseReady(false, message.settings || null, messageText);
        ensureLatencyWatch({ reshuffle: true });
        sendResponse({
          ok: false,
          ready: false,
          error: messageText,
        });
      });
    return true;
  }

  if (type === 'PREPARE_SUPABASE_INSTALL') {
    prepareSupabaseInstall(message.settings || null)
      .then((result) => {
        rememberSupabaseReady(
          result.ready === true,
          message.settings || null,
          result.message,
          result.messageKey,
          result.messageParams,
        );
        return result;
      })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : bt('err.dbInstallPrepare'),
      }));
    return true;
  }

  if (type === 'DELETE_WORD') {
    noteUserActivity();
    requireSupabaseReady()
      .then(() => deleteWordEverywhere(message.word, message.cardId))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : bt('words.deleteFailed'),
      }));
    return true;
  }

  if (type === 'SYNC_KNOWN_WORDS') {
    noteUserActivity();
    requireSupabaseReady()
      .then(() => syncKnownWordsToSupabase({ auto: true }))
      .then((result) => reply(sendResponse, { ok: true, ...result }))
      .catch((error) => reply(sendResponse, {
        ok: false,
        error: error instanceof Error ? error.message : bt('import.err.failed'),
      }));
    return true;
  }

  if (type === 'GET_KNOWN_WORDS_SYNC_STATUS') {
    requireSupabaseReady()
      .then(() => getExtensionSettings())
      .then((settings) => ensureImportProgress(settings, { forceRefreshTotals: Boolean(message.refreshTotals) }))
      .then((progress) => reply(sendResponse, { ok: true, progress }))
      .catch(async (error) => {
        const fallback = await readImportProgress();
        reply(sendResponse, {
          ok: false,
          progress: fallback,
          error: error instanceof Error ? error.message : bt('import.err.statusFailed'),
        });
      });
    return true;
  }

  if (type === 'RESET_LINGQ_IMPORT_PROGRESS') {
    requireSupabaseReady()
      .then(() => getExtensionSettings())
      .then(async (settings) => {
        await clearImportContinueAlarm();
        const fresh = enrichImportProgress(defaultImportProgress(settings.language || 'en'));
        await chrome.storage.local.set({ [KNOWN_WORDS_SYNC_KEY]: fresh });
        const progress = await ensureImportProgress(settings, { forceRefreshTotals: true });
        notifyHighlightRefresh().catch(() => {});
        reply(sendResponse, { ok: true, progress });
      })
      .catch((error) => reply(sendResponse, {
        ok: false,
        error: error instanceof Error ? error.message : bt('import.err.resetFailed'),
      }));
    return true;
  }

  if (type === 'GET_USAGE_STATS') {
    requireSupabaseReady()
      .then(() => getUsageStats(message.period))
      .then((stats) => sendResponse({ ok: true, stats }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : bt('err.statsLoad') }));
    return true;
  }

  if (type === 'GET_LATENCY_STATS') {
    requireSupabaseReady()
      .then(() => getLatencyStats())
      .then((latency) => sendResponse({ ok: true, latency }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : bt('err.latencyLoad') }));
    return true;
  }

  if (type === 'GET_UPDATE_STATUS') {
    getStoredUpdateStatus()
      .then((status) => sendResponse({ ok: true, ...status }))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  if (type === 'CHECK_FOR_UPDATE') {
    checkGithubUpdate({ force: true })
      .then((status) => sendResponse({ ok: true, ...status }))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  if (type === 'DISMISS_UPDATE') {
    dismissUpdateNotice(message.version)
      .then((status) => sendResponse({ ok: true, ...status }))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  return false;
});

async function lookupWord(word, options = {}) {
  const probe = options.probe === true;
  const settings = await getExtensionSettings();
  if (probe) {
    settings.language = PROBE_LANGUAGE;
  }

  if (!isLingqEnabled(settings)) {
    if (probe) {
      throw new Error(bt('err.idleOff'));
    }
    return lookupWordOffline(word, settings);
  }

  if (!settings.apiKey) {
    throw new Error(bt('err.needLingqKey'));
  }

  const cleanWord = normalizeWord(word);
  const card = await findCard(cleanWord, settings);
  const cardStatus = card ? normalizeStatus(card.status, card.extended_status) : 0;

  let result;
  if (card && cardStatus === -1) {
    result = await attachMeanings(cardResult(cleanWord, card, settings), cleanWord, settings);
  } else if (card && cardStatus > 1) {
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
      translation: translations[0] || bt('err.noTranslation'),
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
      translation: translations[0] || bt('err.translationNotFound'),
      translations,
      status: 0,
      cardId: null,
      created: false,
      unknown: true,
    };
  } else {
    const translations = await translateNewWord(cleanWord, settings);
    const translation = translations[0] || bt('err.translationNotFound');
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

function isLingqEnabled(settings) {
  return settings?.lingqEnabled !== false;
}

function canUseOfflineMode(settings) {
  return isSupabaseConfigured(settings)
    && isChatgptEnabled(settings)
    && Boolean(String(settings?.chatgptApiKey || '').trim())
    && settings?.chatgptApiKeyValid === true;
}

function resolveAlternativesSource(settings) {
  if (!isLingqEnabled(settings)) {
    return 'chatgpt';
  }
  const hasKey = Boolean(String(settings.chatgptApiKey || '').trim());
  if (
    isChatgptEnabled(settings)
    && settings.alternativesSource === 'chatgpt'
    && hasKey
    && settings.chatgptApiKeyValid === true
  ) {
    return 'chatgpt';
  }
  return 'lingq';
}

function resolveNewWordTranslationSource(settings) {
  if (!isLingqEnabled(settings)) {
    return 'chatgpt';
  }
  const hasKey = Boolean(String(settings.chatgptApiKey || '').trim());
  if (
    isChatgptEnabled(settings)
    && settings.newWordTranslationSource === 'chatgpt'
    && hasKey
    && settings.chatgptApiKeyValid === true
  ) {
    return 'chatgpt';
  }
  return 'lingq';
}

async function lookupWordOffline(word, settings) {
  if (!canUseOfflineMode(settings)) {
    throw new Error(bt('err.needOfflineStack'));
  }
  const gate = await getSupabaseGate();
  if (!gate.ready) {
    throw new Error(gate.message || supabaseDbRequiredMessage());
  }

  const cleanWord = normalizeWord(word);
  if (!cleanWord) {
    throw new Error(bt('err.missingWord'));
  }

  const existing = await fetchSupabaseWordRow(cleanWord, settings);
  if (existing) {
    const touched = await syncSupabaseWord('touch_word', {
      word: cleanWord,
      translation: existing.translation,
      status: Number(existing.status) || 1,
      cardId: existing.lingq_card_id,
      needsLingqSync: true,
    }, settings);
    const row = touched || existing;
    const translation = String(row.translation || existing.translation || '').trim() || bt('err.noTranslation');
    const rawStatus = Number(row.status ?? existing.status);
    const status = Number.isInteger(rawStatus) ? rawStatus : 1;
    return {
      word: cleanWord,
      translation,
      translations: [translation],
      status,
      cardId: row.lingq_card_id ?? existing.lingq_card_id ?? null,
      created: false,
      // Úroveň 1 je učení, ne „nové neznámé“ — modrá bublina jen u opravdu nových slov.
      unknown: false,
      viewCount: status === -1 ? null : (Number(row.view_count) > 1 ? Number(row.view_count) : null),
      alternativesSource: 'chatgpt',
    };
  }

  const translations = await fetchChatgptPrimaryTranslations(cleanWord, settings);
  const translation = translations[0] || bt('err.translationNotFound');
  const row = await syncSupabaseWord('touch_word', {
    word: cleanWord,
    translation,
    status: 1,
    needsLingqSync: true,
  }, settings);

  return {
    word: cleanWord,
    translation,
    translations,
    status: Number(row?.status) || 1,
    cardId: row?.lingq_card_id ?? null,
    created: true,
    unknown: true,
    viewCount: null,
    alternativesSource: 'chatgpt',
  };
}

async function fetchSupabaseWordRow(word, settings) {
  const baseUrl = String(settings.supabaseUrl || '').replace(/\/$/, '');
  const apiKey = String(settings.supabaseKey || '').trim();
  if (!baseUrl || !apiKey) {
    return null;
  }
  const language = encodeURIComponent(settings.language || 'en');
  const term = encodeURIComponent(normalizeWord(word));
  const { response, json } = await supabaseRest(
    baseUrl,
    apiKey,
    `/rest/v1/words?select=word,language,translation,status,view_count,lingq_card_id,needs_lingq_sync&word=eq.${term}&language=eq.${language}&limit=1`,
  );
  if (!response.ok || !Array.isArray(json) || json.length === 0) {
    return null;
  }
  return json[0];
}

async function fetchWordsNeedingLingqSync(settings) {
  const baseUrl = String(settings.supabaseUrl || '').replace(/\/$/, '');
  const apiKey = String(settings.supabaseKey || '').trim();
  if (!baseUrl || !apiKey) {
    return [];
  }
  const language = encodeURIComponent(settings.language || 'en');
  const { response, json } = await supabaseRest(
    baseUrl,
    apiKey,
    `/rest/v1/words?select=word,translation,status,lingq_card_id&needs_lingq_sync=eq.true&language=eq.${language}&order=updated_at.asc&limit=500`,
  );
  if (!response.ok || !Array.isArray(json)) {
    throw new Error(bt('err.syncLoadWords', { status: response.status }));
  }
  return json;
}

let lingqSyncState = {
  running: false,
  done: 0,
  total: 0,
  errors: 0,
  message: '',
};

async function syncDbToLingq() {
  if (lingqSyncState.running) {
    return lingqSyncState;
  }
  await ensureBgLocale();
  const settings = await getExtensionSettings();
  if (!isLingqEnabled(settings)) {
    return lingqSyncState;
  }
  if (!settings.apiKey) {
    lingqSyncState = {
      running: false,
      done: 0,
      total: 0,
      errors: 0,
      message: bt('sync.skipNoKey'),
    };
    return lingqSyncState;
  }
  if (!isSupabaseConfigured(settings)) {
    return lingqSyncState;
  }

  lingqSyncState = {
    running: true,
    done: 0,
    total: 0,
    errors: 0,
    message: bt('sync.running'),
  };

  try {
    const rows = await fetchWordsNeedingLingqSync(settings);
    lingqSyncState.total = rows.length;
    if (rows.length === 0) {
      lingqSyncState = {
        running: false,
        done: 0,
        total: 0,
        errors: 0,
        message: bt('sync.nothing'),
      };
      return lingqSyncState;
    }

    for (const row of rows) {
      try {
        const word = normalizeWord(row.word);
        const translation = String(row.translation || word).trim() || word;
        const status = Number(row.status) || 1;
        const cardId = await ensureCardId(row.lingq_card_id, word, translation, settings);
        const { body } = toApiStatus(status);
        await lingqRequest(`${getApiBase(settings)}/cards/${encodeURIComponent(cardId)}/`, settings, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        try {
          await updateTranslation(cardId, word, translation);
        } catch {
          // Stav už je v LingQ; překlad zkusíme příště.
        }
        await syncSupabaseWord('update_word_fields', {
          word,
          translation,
          status,
          cardId,
          needsLingqSync: false,
        }, settings);
        lingqSyncState.done += 1;
      } catch {
        lingqSyncState.errors += 1;
      }
      lingqSyncState.message = lingqSyncState.errors
        ? bt('sync.progressErrors', {
          done: lingqSyncState.done,
          total: lingqSyncState.total,
          errors: lingqSyncState.errors,
        })
        : bt('sync.progress', {
          done: lingqSyncState.done,
          total: lingqSyncState.total,
        });
      // Krátká pauza mezi řádky — stejný výsledek, méně nárazů na LingQ API.
      await sleep(80);
    }

    lingqSyncState.running = false;
    lingqSyncState.message = lingqSyncState.errors
      ? bt('sync.doneErrors', {
        done: lingqSyncState.done,
        total: lingqSyncState.total,
        errors: lingqSyncState.errors,
      })
      : bt('sync.done', {
        done: lingqSyncState.done,
        total: lingqSyncState.total,
      });
  } catch (error) {
    lingqSyncState.running = false;
    lingqSyncState.message = getErrorMessage(error);
  }
  return lingqSyncState;
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
  const settings = await getExtensionSettings();
  const cleanWord = normalizeWord(word);
  if (!cleanWord) {
    throw new Error(bt('err.missingWordAlts'));
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
    throw new Error(bt('err.chatgptNoKey'));
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
      throw new Error(bt('err.chatgptInvalid'));
    }
    throw new Error(bt('err.chatgptHttp', { status: response.status }));
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
    throw new Error(bt('err.chatgptNeedKeySettings'));
  }
  // Klíč se ověřuje v nastavení; při běžném překladu netahat znovu /v1/models.
  if (settings.chatgptApiKeyValid === true) {
    return apiKey;
  }
  try {
    await validateChatgptApiKey(apiKey);
    await setExtensionSecrets({ chatgptApiKeyValid: true });
  } catch (error) {
    await setExtensionSecrets({ chatgptApiKeyValid: false });
    await setExtensionPrefs({
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
      throw new Error(bt('err.chatgptTimeout'));
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
      await setExtensionSecrets({ chatgptApiKeyValid: false });
      await setExtensionPrefs({
        alternativesSource: 'lingq',
        newWordTranslationSource: 'lingq',
      });
      throw new Error(bt('err.chatgptInvalid'));
    }
    throw new Error(bt('err.chatgptHttp', { status: response.status }));
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content || '';
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(bt('err.chatgptBadJson'));
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
    throw new Error(bt('err.chatgptBadTranslation'));
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
    throw new Error(bt('err.chatgptBadList'));
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
    translation: translations[0] || bt('err.noTranslation'),
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
    throw new Error(bt('err.missingWordCard'));
  }
  const existing = await findCard(cleanWord, settings);
  const existingId = existing?.pk ?? existing?.id ?? null;
  if (existingId) {
    return String(existingId);
  }
  const created = await createCard(cleanWord, translation || cleanWord, settings);
  const createdId = created?.pk ?? created?.id ?? null;
  if (!createdId) {
    throw new Error(bt('err.lingqNoCardId'));
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
  const settings = await getExtensionSettings();
  invalidateHighlightMapCache();
  const { apiStatus, body } = toApiStatus(status);
  if (!isLingqEnabled(settings)) {
    if (!canUseOfflineMode(settings)) {
      throw new Error(bt('err.needOfflineStack'));
    }
    const uiStatus = Number(status);
    await syncSupabaseWord('update_word_fields', {
      word,
      status: uiStatus,
      translation,
      cardId: cardId || null,
      needsLingqSync: true,
    }, settings);
    return {
      status: uiStatus,
      cardId: cardId || null,
    };
  }
  if (!settings.apiKey) {
    throw new Error(bt('err.lingqCardUpdate'));
  }
  const resolvedCardId = await ensureCardId(cardId, word, translation, settings);
  const url = `${getApiBase(settings)}/cards/${encodeURIComponent(resolvedCardId)}/`;
  const response = await lingqRequest(url, settings, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  const requestedStatus = Number(status);
  const savedStatus = requestedStatus === -1
    ? -1
    : normalizeStatus(response?.status ?? apiStatus, response?.extended_status ?? body.extended_status);
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
      needsLingqSync: false,
    }, settings);
  }
  return {
    status: savedStatus,
    cardId: resolvedCardId,
  };
}

async function updateTranslation(cardId, word, translation) {
  const settings = await getExtensionSettings();
  const text = String(translation || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    throw new Error(bt('err.lingqEmptyTranslation'));
  }
  if (!isLingqEnabled(settings)) {
    if (!canUseOfflineMode(settings)) {
      throw new Error(bt('err.needOfflineStack'));
    }
    await syncSupabaseWord('update_word_fields', {
      word,
      translation: text,
      cardId: cardId || null,
      needsLingqSync: true,
    }, settings);
    return { translation: text, cardId: cardId || null };
  }
  if (!settings.apiKey) {
    throw new Error(bt('err.lingqCardUpdate'));
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
      needsLingqSync: false,
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
    needsLingqSync: false,
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
  if (uiStatus === -1) {
    return { apiStatus: -1, body: { status: -1, extended_status: null } };
  }
  if (!Number.isInteger(uiStatus) || uiStatus < 1 || uiStatus > 5) {
    throw new Error(bt('err.lingqBadStatus'));
  }
  const apiStatus = uiStatus === 5 ? 3 : uiStatus - 1;
  const body = uiStatus === 5
    ? { status: 3, extended_status: 3 }
    : { status: apiStatus, extended_status: null };
  return { apiStatus, body };
}

function wantsChatgptPhraseTranslation(settings) {
  if (!isLingqEnabled(settings)) {
    return true;
  }
  return settings.phraseTranslationSource === 'chatgpt';
}

async function translatePhrase(text) {
  const settings = await getExtensionSettings();
  const phrase = String(text || '').replace(/\s+/g, ' ').trim();
  if (!phrase) {
    throw new Error(bt('err.selectPhrase'));
  }

  if (wantsChatgptPhraseTranslation(settings)) {
    if (!isLingqEnabled(settings) && !canUseOfflineMode(settings)) {
      throw new Error(bt('err.needOfflineStack'));
    }
    if (!settings.chatgptEnabled || !String(settings.chatgptApiKey || '').trim()) {
      throw new Error(bt('err.chatgptPhraseNeedKey'));
    }
    const translation = await fetchChatgptPhraseTranslation(phrase, settings);
    return { sentence: phrase, translation };
  }

  if (!settings.apiKey) {
    throw new Error(bt('err.needLingqKey'));
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
    throw new Error(bt('err.phraseFailed'));
  }
  return { sentence: phrase, translation };
}

async function fetchChatgptPhraseTranslation(phrase, settings) {
  const sourceName = languageLabel(settings.language);
  const targetName = languageLabel(settings.targetLanguage);
  const parsed = await callChatgptJson(settings, [
    {
      role: 'system',
      content: 'You translate short phrases for language learners. Reply with JSON only.',
    },
    {
      role: 'user',
      content: [
        `Phrase in ${sourceName}: "${phrase}"`,
        `Target language: ${targetName}`,
        'Return JSON object {"translations":["..."]} with one natural translation first.',
        'No explanations.',
      ].join('\n'),
    },
  ]);
  const translations = parseChatgptTranslationList(parsed);
  const translation = translations[0] || '';
  if (!translation || translation.toLowerCase() === phrase.toLowerCase()) {
    throw new Error(bt('err.chatgptBadPhrase'));
  }
  return translation;
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

  throw lastError || new Error(bt('err.phraseFailed'));
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
  const matches = results.filter((card) => cardMatches(card, word));
  const active = matches.filter((card) => Number(card.status) !== -1);
  const pool = active.length > 0 ? active : matches;
  pool.sort((left, right) => {
    const leftStatus = normalizeStatus(left.status, left.extended_status);
    const rightStatus = normalizeStatus(right.status, right.extended_status);
    return rightStatus - leftStatus;
  });
  return pool[0] || null;
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
/** Jedna dávka z LingQ → DB, pak pauza, pak další — dokud není hotovo. */
const IMPORT_BATCH_SIZE = 500;
const IMPORT_COOLDOWN_MS = 5 * 1000;
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
  // Souběžné lookupy sdílí jeden download — stejná data, bez násobení requestů.
  if (!onProgress && knownWordsFetchPromise) {
    return knownWordsFetchPromise;
  }

  const run = (async () => {
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
  })();

  if (!onProgress) {
    const tracked = run.finally(() => {
      if (knownWordsFetchPromise === tracked) {
        knownWordsFetchPromise = null;
      }
    });
    knownWordsFetchPromise = tracked;
    return tracked;
  }

  return run;
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
  if (!text || !Number.isInteger(level) || (level !== -1 && (level < 1 || level > 5))) {
    return;
  }
  if (level === -1) {
    const meaning = String(meta.translation || '').replace(/\s+/g, ' ').trim() || null;
    const importance = Number.isInteger(Number(meta.importance)) ? Number(meta.importance) : null;
    const popularity = Number.isInteger(Number(meta.popularity)) ? Number(meta.popularity) : null;
    const previous = map.get(text);
    // Ignored přebije učení jen když už v dávce není silnější aktivní stav.
    if (previous && previous.status >= 1) {
      return;
    }
    map.set(text, {
      status: -1,
      translation: meaning || previous?.translation || null,
      importance: importance ?? previous?.importance ?? null,
      popularity: popularity ?? previous?.popularity ?? null,
    });
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
    autoContinue: false,
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

async function clearImportContinueAlarm() {
  await chrome.alarms.clear(IMPORT_CONTINUE_ALARM);
}

async function scheduleImportContinue(whenMs) {
  const delayMs = Math.max(Number(whenMs) - Date.now(), 1_000);
  // chrome.alarms: delayInMinutes; u unpacked funguje i < 1 min
  await chrome.alarms.create(IMPORT_CONTINUE_ALARM, {
    delayInMinutes: Math.max(delayMs / 60_000, 0.05),
  });
}

async function resumeImportIfDue({ reason } = {}) {
  if (knownWordsSyncRunning) {
    return null;
  }
  const progress = await readImportProgress();
  if (!progress || !progress.autoContinue || progress.phase === 'done') {
    return null;
  }
  const remaining = Number(progress.cooldownUntil) - Date.now();
  if (remaining > 1_000) {
    await scheduleImportContinue(progress.cooldownUntil);
    return progress;
  }
  try {
    await requireSupabaseReady();
    return await syncKnownWordsToSupabase({ auto: true, reason });
  } catch {
    await scheduleImportContinue(Date.now() + IMPORT_COOLDOWN_MS);
    return null;
  }
}

resumeImportIfDue({ reason: 'startup' }).catch(() => {});

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
  [-1, 0, 1, 2, 3, 4].forEach((status) => params.append('status', String(status)));
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

  // Vždy aktuální tempo (500 / 5 s) — i když ve storage zbyla stará 5 000 / 1 h.
  progress.batchSize = IMPORT_BATCH_SIZE;
  progress.cooldownMs = IMPORT_COOLDOWN_MS;

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
  [-1, 0, 1, 2, 3, 4].forEach((status) => params.append('status', String(status)));
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
        const err = new Error(bt('import.err.rateLimit'));
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
        const err = new Error(bt('import.err.rateLimit'));
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

async function syncKnownWordsToSupabase({ auto = false } = {}) {
  if (knownWordsSyncRunning) {
    throw new Error(bt('import.err.busy'));
  }

  knownWordsSyncRunning = true;
  const settings = await getExtensionSettings();
  try {
    if (!settings.apiKey) {
      throw new Error(bt('err.needLingqKey'));
    }
    const baseUrl = String(settings.supabaseUrl || '').replace(/\/$/, '');
    const apiKey = String(settings.supabaseKey || '').trim();
    if (!baseUrl || !apiKey) {
      throw new Error(bt('import.err.needSupabase'));
    }

    let progress = await ensureImportProgress(settings, { forceRefreshTotals: !auto });
    if (progress.phase === 'done') {
      await clearImportContinueAlarm();
      return enrichImportProgress({
        ...progress,
        autoContinue: false,
        messageKey: 'import.msg.alreadyDone',
        messageParams: {},
        message: bt('import.msg.alreadyDone'),
      });
    }

    const remaining = Number(progress.cooldownUntil) - Date.now();
    if (remaining > 0) {
      if ((auto || progress.autoContinue) && remaining <= IMPORT_COOLDOWN_MS + 5_000) {
        await sleep(remaining);
      } else if (auto || progress.autoContinue) {
        await scheduleImportContinue(progress.cooldownUntil);
        const waiting = enrichImportProgress({
          ...progress,
          autoContinue: true,
          running: false,
          messageKey: 'import.msg.autoWaiting',
          messageParams: {},
          message: bt('import.msg.autoWaiting'),
        });
        await chrome.storage.local.set({ [KNOWN_WORDS_SYNC_KEY]: waiting });
        return waiting;
      } else {
        const seconds = Math.max(1, Math.ceil(remaining / 1000));
        throw new Error(bt('import.err.cooldown', { seconds }));
      }
    }

    progress = enrichImportProgress({
      ...progress,
      autoContinue: true,
      running: true,
      error: null,
      messageKey: progress.phase === 'known'
        ? 'import.msg.fetchingKnown'
        : 'import.msg.fetchingCards',
      messageParams: {},
      message: progress.phase === 'known'
        ? bt('import.msg.fetchingKnown')
        : bt('import.msg.fetchingCards'),
    });
    await chrome.storage.local.set({ [KNOWN_WORDS_SYNC_KEY]: progress });
    notifyHighlightRefresh().catch(() => {});

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
              messageKey: 'import.msg.fetchingKnownProgress',
              messageParams: { n: fetchedKnown, total: knownTotal },
              message: bt('import.msg.fetchingKnownProgress', { n: fetchedKnown, total: knownTotal }),
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
              messageKey: 'import.msg.fetchingCardsProgress',
              messageParams: { n: fetchedCards, total: totalCards },
              message: bt('import.msg.fetchingCardsProgress', { n: fetchedCards, total: totalCards }),
            }).catch(() => {});
          },
        });
      }
    } catch (error) {
      if (error?.code === 'RATE_LIMIT' && error.partial?.items?.length) {
        const upload = await uploadVocabularyItems(settings, error.partial.items);
        const cooldownUntil = Date.now() + IMPORT_COOLDOWN_MS;
        const next = enrichImportProgress({
          ...progress,
          autoContinue: true,
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
        await scheduleImportContinue(cooldownUntil);
        throw error;
      }
      throw error;
    }

    await setKnownWordsSyncProgress({
      running: true,
      messageKey: 'import.msg.uploading',
      messageParams: { n: batchResult.items.length },
      message: bt('import.msg.uploading', { n: batchResult.items.length }),
    });

    const upload = batchResult.items.length
      ? await uploadVocabularyItems(settings, batchResult.items, {
        onProgress: async ({ uploaded, total }) => {
          await setKnownWordsSyncProgress({
            running: true,
            messageKey: 'import.msg.uploadingProgress',
            messageParams: { n: uploaded, total },
            message: bt('import.msg.uploadingProgress', { n: uploaded, total }),
          }).catch(() => {});
        },
      })
      : { uploaded: 0, inserted: 0, updated: 0 };

    const cooldownUntil = Date.now() + (progress.cooldownMs || IMPORT_COOLDOWN_MS);
    let nextPhase = progress.phase;
    let message;
    let messageKey;
    let messageParams;

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
      if (cardsDone) {
        messageKey = 'import.msg.cardsDone';
        messageParams = { n: importedCards };
        message = bt('import.msg.cardsDone', { n: importedCards });
      } else {
        messageKey = 'import.msg.cardsBatch';
        messageParams = { n: importedCards, total: progress.totalCards };
        message = bt('import.msg.cardsBatch', { n: importedCards, total: progress.totalCards });
      }
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
      if (knownDone) {
        messageKey = 'import.msg.importDone';
        messageParams = { n: knownImported, total: progress.knownTotal };
        message = bt('import.msg.importDone', { n: knownImported, total: progress.knownTotal });
      } else {
        messageKey = 'import.msg.knownBatch';
        messageParams = { n: knownImported, total: progress.knownTotal };
        message = bt('import.msg.knownBatch', { n: knownImported, total: progress.knownTotal });
      }
    }

    const done = nextPhase === 'done';
    const result = enrichImportProgress({
      ...progress,
      autoContinue: !done,
      running: false,
      lastBatchAt: Date.now(),
      cooldownUntil: done ? null : cooldownUntil,
      cooldownMs: IMPORT_COOLDOWN_MS,
      batchSize: IMPORT_BATCH_SIZE,
      insertedTotal: (Number(progress.insertedTotal) || 0) + upload.inserted,
      updatedTotal: (Number(progress.updatedTotal) || 0) + upload.updated,
      lastBatchInserted: upload.inserted,
      lastBatchUpdated: upload.updated,
      lastBatchFetched: batchResult.items.length,
      error: null,
      messageKey,
      messageParams,
      message,
    });
    await chrome.storage.local.set({ [KNOWN_WORDS_SYNC_KEY]: result });
    if (done) {
      await clearImportContinueAlarm();
      notifyHighlightRefresh().catch(() => {});
      return result;
    }
    // Alarm jako záloha; přesných 5 s drží sleep ve stejném běhu (alarm často min. ~1 min).
    await scheduleImportContinue(cooldownUntil);
    knownWordsSyncRunning = false;
    await sleep(IMPORT_COOLDOWN_MS);
    return syncKnownWordsToSupabase({ auto: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : bt('import.err.failed');
    const current = await readImportProgress();
    const keepAuto = Boolean(current?.autoContinue) || auto;
    await setKnownWordsSyncProgress({
      ...(current || {}),
      running: false,
      error: message,
      message,
    });
    if (keepAuto && current?.phase !== 'done') {
      await scheduleImportContinue(Date.now() + IMPORT_COOLDOWN_MS);
    }
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
      throw new Error(bt('import.err.rpcMissing'));
    }
    throw new Error(bt('err.supabaseHttp', { status: response.status }));
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
      throw new Error(bt('err.lingqInvalidKey'));
    }
    if (response.status === 404) {
      throw new Error(bt('err.lingqUnsupported'));
    }
    throw new Error(bt('err.lingqHttp', { status: response.status }));
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
  if (typeof status === 'string') {
    const named = status.toLowerCase();
    if (named === 'known') {
      return 5;
    }
    if (named === 'ignored' || named === 'ignore') {
      return -1;
    }
  }

  const numericStatus = Number(status);
  const extended = extendedStatus == null || extendedStatus === '' ? null : Number(extendedStatus);
  if (!Number.isInteger(numericStatus)) {
    return 1;
  }
  if (numericStatus === -1) {
    return -1;
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

/** Jednotný klíč pro podbarvení — musí sedět s content.js. */
function highlightLookupKey(word) {
  return String(word || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\u00AD\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/["'`''""‚„«.!,?;:()[\]{}<>]/g, '')
    .replace(/^[\s\u00A0]+|[\s\u00A0]+$/g, '');
}

function highlightKeyVariants(word) {
  const raw = String(word || '');
  const lower = raw.normalize('NFC').toLowerCase().replace(/^[\s\u00A0]+|[\s\u00A0]+$/g, '');
  const noSoft = lower.replace(/[\u00AD\u200B-\u200D\uFEFF]/g, '');
  const stripped = highlightLookupKey(raw);
  const noHyphen = stripped.replace(/-/g, '');
  return [...new Set([stripped, noSoft, lower, noHyphen].filter(Boolean))];
}

function highlightMergePriority(status) {
  const value = Number(status);
  if (value === 5) {
    return 300; // K — nejvyšší priorita, nikdy nepřepsat učením
  }
  if (value === -1) {
    return 250; // Ignored — bez barvy, nepřepsat žlutou
  }
  if (value === 6) {
    return 200; // v DB bez překladu
  }
  if (value >= 1 && value <= 4) {
    return value;
  }
  return 0;
}

function assignHighlightStatus(words, rawWord, mappedStatus) {
  const nextPriority = highlightMergePriority(mappedStatus);
  for (const key of highlightKeyVariants(rawWord)) {
    const previous = words[key];
    if (previous == null || nextPriority > highlightMergePriority(previous)) {
      words[key] = mappedStatus;
    }
  }
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : bt('err.lingqConnect');
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
    invalidateHighlightMapCache();
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

const EXTENSION_SCHEMA_VERSION = '5';
const SUPABASE_INSTALL_SQL_FILES = [
  'supabase/schema.sql',
  'supabase/import_known_words.sql',
  'supabase/usage_stats.sql',
  'supabase/latency.sql',
  'supabase/latency_status_phrase.sql',
  'supabase/lingq_offline_sync.sql',
  'supabase/ignored_status.sql',
  'supabase/schema_version.sql',
];
function supabaseDbRequiredMessage() {
  return bt('db.required');
}

let supabaseReadyCache = {
  key: '',
  ready: false,
  checkedAt: 0,
  message: '',
  messageKey: '',
  messageParams: {},
  versionOk: true,
  structureOk: true,
  installedVersion: null,
};
const SUPABASE_READY_TTL_MS = 5 * 60 * 1000;

function isSupabaseEnabled(settings) {
  return settings?.supabaseEnabled !== false;
}

function isChatgptEnabled(settings) {
  return settings?.chatgptEnabled !== false;
}

function isSupabaseConfigured(settings) {
  if (!isSupabaseEnabled(settings)) {
    return false;
  }
  const baseUrl = String(settings?.supabaseUrl || '').trim().replace(/\/$/, '');
  const apiKey = String(settings?.supabaseKey || '').trim();
  return Boolean(baseUrl && apiKey);
}

function supabaseSettingsCacheKey(settings) {
  return `${String(settings?.supabaseUrl || '').trim().replace(/\/$/, '')}|${String(settings?.supabaseKey || '').trim()}`;
}

function invalidateSupabaseReadyCache() {
  supabaseReadyCache = {
    key: '',
    ready: false,
    checkedAt: 0,
    message: '',
    messageKey: '',
    messageParams: {},
    versionOk: true,
    structureOk: true,
    installedVersion: null,
  };
}

function rememberSupabaseReady(ready, override = null, message = '', messageKey = '', messageParams = {}) {
  const settings = override || {};
  const key = supabaseSettingsCacheKey(settings);
  let resolvedKey = messageKey || '';
  let resolvedParams = messageParams || {};
  if (!resolvedKey) {
    if (ready) {
      resolvedKey = 'db.ready';
      resolvedParams = { version: EXTENSION_SCHEMA_VERSION };
    } else if (!message) {
      resolvedKey = 'db.required';
    }
  }
  supabaseReadyCache = {
    key,
    ready: ready === true,
    checkedAt: Date.now(),
    messageKey: resolvedKey,
    messageParams: resolvedParams,
    message: message || (resolvedKey ? bt(resolvedKey, resolvedParams) : ''),
    versionOk: ready === true,
    structureOk: ready === true,
    installedVersion: ready === true ? EXTENSION_SCHEMA_VERSION : null,
  };
}

async function getSupabaseGate({ force = false } = {}) {
  await ensureBgLocale();
  const settings = await getExtensionSettings();
  if (!isSupabaseEnabled(settings)) {
    invalidateSupabaseReadyCache();
    return {
      ready: false,
      configured: false,
      enabled: false,
      messageKey: 'db.off',
      messageParams: {},
      message: bt('db.off'),
      expectedVersion: EXTENSION_SCHEMA_VERSION,
      installedVersion: null,
    };
  }
  const configured = isSupabaseConfigured(settings);
  if (!configured) {
    invalidateSupabaseReadyCache();
    return {
      ready: false,
      configured: false,
      enabled: true,
      messageKey: 'db.fillKeys',
      messageParams: {},
      message: bt('db.fillKeys'),
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
    const messageKey = supabaseReadyCache.messageKey
      || (supabaseReadyCache.ready ? 'db.ready' : 'db.required');
    const messageParams = supabaseReadyCache.messageParams
      || (supabaseReadyCache.ready ? { version: EXTENSION_SCHEMA_VERSION } : {});
    return {
      ready: supabaseReadyCache.ready,
      configured: true,
      enabled: true,
      messageKey,
      messageParams,
      message: bt(messageKey, messageParams),
      expectedVersion: EXTENSION_SCHEMA_VERSION,
      installedVersion: supabaseReadyCache.installedVersion,
      versionOk: supabaseReadyCache.versionOk !== false,
      structureOk: supabaseReadyCache.structureOk !== false,
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
      messageKey: check.messageKey || '',
      messageParams: check.messageParams || {},
      versionOk: check.versionOk !== false,
      structureOk: check.structureOk !== false,
      installedVersion: check.installedVersion ?? null,
    };
    return {
      ...check,
      ready: check.ready === true,
      configured: true,
      enabled: true,
      fromCache: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : supabaseDbRequiredMessage();
    supabaseReadyCache = {
      key,
      ready: false,
      checkedAt: Date.now(),
      message,
      messageKey: error instanceof Error ? '' : 'db.required',
      messageParams: {},
    };
    return {
      ready: false,
      configured: true,
      message,
      messageKey: error instanceof Error ? '' : 'db.required',
      messageParams: {},
      expectedVersion: EXTENSION_SCHEMA_VERSION,
      installedVersion: null,
      fromCache: false,
    };
  }
}

async function requireSupabaseReady() {
  const gate = await getSupabaseGate();
  if (!gate.ready) {
    throw new Error(gate.message || supabaseDbRequiredMessage());
  }
  return gate;
}

async function resolveSupabaseSettings(override = null) {
  await ensureBgLocale();
  const stored = await getExtensionSettings();
  const baseUrl = String(override?.supabaseUrl || stored.supabaseUrl || '').trim().replace(/\/$/, '');
  const apiKey = String(override?.supabaseKey || stored.supabaseKey || '').trim();
  if (!baseUrl || !apiKey) {
    throw new Error(bt('db.fillKeysShort'));
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(baseUrl)) {
    throw new Error(bt('db.badUrl'));
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
  await ensureBgLocale();
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
      present.push(bt('db.table', { id: check.id }));
    } else if (response.status === 401 || response.status === 403) {
      throw new Error(bt('db.badKeyTables'));
    } else if (supabaseMissingMessage(json || text)) {
      missing.push(bt('db.table', { id: check.id }));
    } else {
      missing.push(bt('db.tableError', { id: check.id, status: response.status }));
    }
  }

  // RPC musíme volat se správnými pojmenovanými argumenty.
  // Prázdné {} u touch_word/update_word_fields PostgREST hlásí jako „funkce neexistuje“ (PGRST202).
  const probeWord = `__lingq_schema_probe_${Date.now()}__`;
  const rpcChecks = [
    {
      id: 'touch_word',
      body: {
        p_word: probeWord,
        p_language: 'en',
        p_translation: 'schema probe',
        p_status: 1,
      },
    },
    {
      id: 'update_word_fields',
      body: {
        p_word: probeWord,
        p_language: 'en',
        p_status: 1,
      },
    },
    {
      id: 'import_lingq_words',
      body: { p_language: 'en', p_words: [], p_statuses: [] },
    },
    {
      id: 'get_usage_stats',
      body: { p_language: 'en' },
    },
  ];

  for (const check of rpcChecks) {
    const { response, json, text } = await supabaseRest(baseUrl, apiKey, `/rest/v1/rpc/${check.id}`, {
      method: 'POST',
      body: check.body,
    });
    if (response.ok) {
      present.push(bt('db.fn', { id: check.id }));
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(bt('db.badKeyRpc'));
    }
    if (supabaseMissingMessage(json || text)) {
      missing.push(bt('db.fn', { id: check.id }));
    } else {
      // Funkce existuje, ale volání selhalo z jiného důvodu (RLS, data…).
      present.push(bt('db.fn', { id: check.id }));
    }
  }

  // Úklid všech zkušebních řádků z touch_word / update_word_fields (i starších).
  await cleanupSchemaProbeWords(baseUrl, apiKey);

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

  let messageKey;
  let messageParams = {};
  if (ready) {
    messageKey = 'db.ready';
    messageParams = { version: EXTENSION_SCHEMA_VERSION };
  } else if (structureOk && !installedVersion) {
    messageKey = 'db.missingVersionMark';
  } else if (structureOk && !versionOk) {
    messageKey = 'db.versionMismatch';
    messageParams = {
      installed: installedVersion || '?',
      expected: EXTENSION_SCHEMA_VERSION,
    };
  } else {
    messageKey = 'db.missing';
    messageParams = { items: missing.join(', ') };
  }

  return {
    ready,
    structureOk,
    versionOk,
    expectedVersion: EXTENSION_SCHEMA_VERSION,
    installedVersion,
    missing,
    present,
    messageKey,
    messageParams,
    message: bt(messageKey, messageParams),
  };
}

async function loadSupabaseInstallSql() {
  const chunks = [];
  for (const file of SUPABASE_INSTALL_SQL_FILES) {
    const response = await fetch(chrome.runtime.getURL(file));
    if (!response.ok) {
      throw new Error(bt('db.loadFileFailed', { file }));
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

function isSchemaProbeWord(word) {
  return /^__lingq_schema_probe_\d+__$/i.test(String(word || '').trim());
}

async function cleanupSchemaProbeWords(baseUrl, apiKey) {
  if (!baseUrl || !apiKey) {
    return;
  }
  // PostgREST: * = SQL %
  const path = '/rest/v1/words?word=like.__lingq_schema_probe_*';
  await fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      Prefer: 'return=minimal',
    },
  }).catch(() => {});
}

const WORDS_PAGE_SIZE = 500;
const WORDS_SELECT = 'id,word,view_count,status,translation,language,lingq_card_id,importance,popularity,import_note,created_at,updated_at';

function escapePostgrestFilterValue(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/\*/g, '')
    .replace(/,/g, ' ')
    .replace(/[()]/g, '');
}

async function getSupabaseWordsClient() {
  const settings = await getExtensionSettings();
  const baseUrl = String(settings.supabaseUrl || '').replace(/\/$/, '');
  const apiKey = String(settings.supabaseKey || '').trim();
  if (!baseUrl || !apiKey) {
    throw new Error(bt('import.err.needSupabase'));
  }
  return {
    settings,
    baseUrl,
    apiKey,
    language: settings.language || 'en',
  };
}

/** V mapě podbarvení: 6 = v DB bez překladu → nepodbarvovat (stejně jako K). */
const HIGHLIGHT_SKIP_NO_TRANSLATION = 6;

async function isImportBlockingHighlight() {
  const progress = await readImportProgress();
  if (!progress || progress.phase === 'done') {
    return false;
  }
  return Boolean(progress.autoContinue)
    || Boolean(progress.running)
    || (Number(progress.importedCards) || 0) > 0
    || (Number(progress.knownImported) || 0) > 0
    || (Number(progress.cooldownUntil) || 0) > Date.now();
}

async function notifyHighlightRefresh() {
  invalidateHighlightMapCache();
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map((tab) => new Promise((resolve) => {
      if (tab.id == null) {
        resolve();
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'REFRESH_HIGHLIGHTS', force: true }, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    })));
  } catch {
    // Žádné otevřené taby / content script.
  }
}

/**
 * Mapa slovíček pro podbarvení stránky — jen Supabase.
 * 1–4 = žlutá, 5 = K bez barvy, 6 = v DB bez překladu bez barvy, chybějící klíč = neznámé (modrá).
 */
async function getHighlightWordMap({ force = false } = {}) {
  const settings = await getExtensionSettings();
  const language = settings.language || 'en';
  if (settings.highlightEnabled === false) {
    return { words: {}, language, enabled: false, ready: false };
  }
  if (await isImportBlockingHighlight()) {
    return {
      words: {},
      language,
      enabled: false,
      ready: false,
      blockedByImport: true,
    };
  }
  if (!isSupabaseConfigured(settings)) {
    return { words: {}, language, enabled: true, ready: false };
  }

  const gate = await getSupabaseGate({ force: false });
  if (!gate.ready) {
    return { words: {}, language, enabled: true, ready: false };
  }

  const now = Date.now();
  if (
    !force
    && highlightMapCache.words
    && highlightMapCache.language === language
    && now - highlightMapCache.at < HIGHLIGHT_MAP_TTL_MS
  ) {
    return {
      words: highlightMapCache.words,
      language,
      enabled: true,
      ready: true,
      cached: true,
    };
  }

  const baseUrl = String(settings.supabaseUrl || '').replace(/\/$/, '');
  const apiKey = String(settings.supabaseKey || '').trim();
  const words = Object.create(null);

  async function fetchHighlightPages(statusFilter) {
    let offset = 0;
    for (let page = 0; page < HIGHLIGHT_MAP_MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        select: 'word,status,translation',
        language: `eq.${language}`,
        status: statusFilter,
        order: 'id.asc',
        limit: String(HIGHLIGHT_MAP_PAGE_SIZE),
        offset: String(offset),
      });
      const response = await fetch(`${baseUrl}/rest/v1/words?${params}`, {
        method: 'GET',
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
        },
      });
      if (!response.ok) {
        throw new Error(bt('err.supabaseHttp', { status: response.status }));
      }
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        break;
      }
      for (const row of rows) {
        const status = Number(row.status);
        if (!Number.isInteger(status) || (status !== -1 && (status < 1 || status > 5))) {
          continue;
        }
        const hasTranslation = Boolean(String(row.translation || '').trim());
        // K / Ignored bez barvy. Jinak bez překladu = 6 (bez barvy), 1–4 = žlutá.
        let mapped;
        if (status === 5 || status === -1) {
          mapped = status;
        } else if (!hasTranslation) {
          mapped = HIGHLIGHT_SKIP_NO_TRANSLATION;
        } else {
          mapped = status;
        }
        assignHighlightStatus(words, row.word, mapped);
      }
      if (rows.length < HIGHLIGHT_MAP_PAGE_SIZE) {
        break;
      }
      offset += HIGHLIGHT_MAP_PAGE_SIZE;
    }
  }

  // Nejdřív K a Ignored, ať se neutnou limitem za učícími slovíčky.
  await fetchHighlightPages('eq.5');
  await fetchHighlightPages('eq.-1');
  await fetchHighlightPages('in.(1,2,3,4)');

  highlightMapCache = { language, at: now, words };
  return {
    words,
    language,
    enabled: true,
    ready: true,
    cached: false,
    count: Object.keys(words).length,
  };
}

async function countSupabaseWords() {
  const { baseUrl, apiKey, language } = await getSupabaseWordsClient();
  const params = new URLSearchParams({
    select: 'id',
    language: `eq.${language}`,
    status: 'in.(1,2,3,4,5)',
  });
  const response = await fetch(`${baseUrl}/rest/v1/words?${params}`, {
    method: 'HEAD',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      Prefer: 'count=exact',
    },
  });
  if (!response.ok && response.status !== 206) {
    throw new Error(bt('err.supabaseHttp', { status: response.status }));
  }
  const contentRange = response.headers.get('content-range') || '';
  const totalMatch = contentRange.match(/\/(\d+)$/);
  return totalMatch ? Number(totalMatch[1]) : 0;
}

function buildWordsFilterParams({
  language,
  mode,
  letter,
  query,
  status,
  order,
  limit,
  offset,
}) {
  const params = new URLSearchParams({
    select: WORDS_SELECT,
    language: `eq.${language || 'en'}`,
  });

  const statusNum = Number(status);
  if (Number.isInteger(statusNum) && statusNum >= 1 && statusNum <= 5) {
    params.append('status', `eq.${statusNum}`);
  } else {
    // Ignored (−1) se ve slovníku neukazuje.
    params.append('status', 'in.(1,2,3,4,5)');
  }

  if (mode === 'top') {
    params.set('order', order || 'view_count.desc.nullslast,word.asc');
    params.set('limit', String(limit || 200));
    params.set('offset', String(offset || 0));
    return params;
  }

  if (mode === 'search') {
    const needle = escapePostgrestFilterValue(query).trim();
    if (needle.length < 1) {
      throw new Error(bt('words.loadFailed'));
    }
    params.set('or', `(word.ilike.*${needle}*,translation.ilike.*${needle}*)`);
    params.set('order', order || 'word.asc,id.asc');
    params.set('limit', String(limit || WORDS_PAGE_SIZE));
    params.set('offset', String(offset || 0));
    return params;
  }

  const key = String(letter || '').toUpperCase();
  if (key === '#') {
    const parts = [...'abcdefghijklmnopqrstuvwxyz'].map((ch) => `word.not.ilike.${ch}*`);
    params.set('and', `(${parts.join(',')})`);
  } else if (/^[A-Z]$/.test(key)) {
    params.set('word', `ilike.${key.toLowerCase()}*`);
  } else {
    throw new Error(bt('words.loadFailed'));
  }
  params.set('order', order || 'word.asc,id.asc');
  params.set('limit', String(limit || WORDS_PAGE_SIZE));
  params.set('offset', String(offset || 0));
  return params;
}

async function fetchSupabaseWordsPage(client, params) {
  const response = await fetch(`${client.baseUrl}/rest/v1/words?${params}`, {
    method: 'GET',
    headers: {
      apikey: client.apiKey,
      Authorization: `Bearer ${client.apiKey}`,
      Accept: 'application/json',
      Prefer: 'count=exact',
    },
  });

  if (!response.ok && response.status !== 206) {
    throw new Error(bt('err.supabaseHttp', { status: response.status }));
  }

  const rows = await response.json();
  const batch = Array.isArray(rows) ? rows : [];
  if (batch.some((row) => isSchemaProbeWord(row?.word))) {
    void cleanupSchemaProbeWords(client.baseUrl, client.apiKey);
  }

  const words = batch.filter((row) => !isSchemaProbeWord(row?.word));
  const contentRange = response.headers.get('content-range') || '';
  const totalMatch = contentRange.match(/\/(\d+)$/);
  const total = totalMatch ? Number(totalMatch[1]) : null;
  const pageOffset = Number(params.get('offset') || 0);
  const pageSize = Number(params.get('limit') || WORDS_PAGE_SIZE);
  const nextOffset = pageOffset + batch.length;
  const done = batch.length < pageSize || (total != null && nextOffset >= total);

  return { words, total, nextOffset, pageSize, done, rawCount: batch.length };
}

async function listSupabaseWordsByFilter(options = {}) {
  const client = await getSupabaseWordsClient();
  const mode = String(options.mode || 'letter');
  const maxRows = mode === 'top'
    ? Math.min(500, Math.max(1, Number(options.limit) || 200))
    : mode === 'search'
      ? Math.min(500, Math.max(1, Number(options.limit) || 200))
      : 20000;

  const list = [];
  let offset = 0;
  let total = null;
  let guard = 0;

  while (guard < 80) {
    guard += 1;
    const pageLimit = mode === 'top' || mode === 'search'
      ? maxRows
      : WORDS_PAGE_SIZE;
    const params = buildWordsFilterParams({
      language: client.language,
      mode,
      letter: options.letter,
      query: options.query,
      status: options.status,
      order: options.order,
      limit: pageLimit,
      offset,
    });

    const page = await fetchSupabaseWordsPage(client, params);
    list.push(...page.words);
    if (page.total != null) {
      total = page.total;
    }
    if (mode === 'top' || mode === 'search' || page.done || list.length >= maxRows) {
      break;
    }
    offset = page.nextOffset;
  }

  return {
    words: list.slice(0, maxRows),
    total: total != null ? total : list.length,
    mode,
    letter: options.letter || null,
    query: options.query || null,
  };
}

async function listSupabaseWordsPage(offset = 0, limit = WORDS_PAGE_SIZE) {
  const client = await getSupabaseWordsClient();
  const pageSize = Math.min(1000, Math.max(1, Number(limit) || WORDS_PAGE_SIZE));
  const pageOffset = Math.max(0, Number(offset) || 0);
  const params = new URLSearchParams({
    select: WORDS_SELECT,
    language: `eq.${client.language}`,
    order: 'word.asc,id.asc',
    limit: String(pageSize),
    offset: String(pageOffset),
  });
  const page = await fetchSupabaseWordsPage(client, params);
  return {
    words: page.words,
    offset: pageOffset,
    nextOffset: page.nextOffset,
    pageSize: page.pageSize,
    total: page.total,
    done: page.done,
  };
}

async function deleteWordEverywhere(word, cardId = null) {
  const settings = await getExtensionSettings();
  invalidateHighlightMapCache();
  const original = String(word || '').trim();
  const text = normalizeWord(original);
  if (!text) {
    throw new Error(bt('err.missingWordDelete'));
  }
  if (!settings.apiKey) {
    throw new Error(bt('err.needLingqKey'));
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
      throw new Error(bt('err.lingqNoCardIdDelete'));
    }
    resolvedCardId = String(createdId);
    lingqDeleted = await deleteLingqCard(resolvedCardId, settings);
    if (!lingqDeleted) {
      throw new Error(bt('err.lingqDelete'));
    }
  }

  if (!lingqDeleted) {
    const stillThere = await findCard(text, settings).catch(() => null);
    if (stillThere) {
      throw new Error(bt('err.lingqDelete'));
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
      throw new Error(bt('err.lingqInvalidKey'));
    }
    // 404 / jiná chyba — zkusíme ještě v2.
  }

  if (lastStatus === 404) {
    return false;
  }
  throw new Error(bt('err.lingqDeleteHttp', { status: lastStatus || bt('err.unknown') }));
}

async function deleteSupabaseWord(word, settings) {
  const baseUrl = String(settings.supabaseUrl || '').replace(/\/$/, '');
  const apiKey = String(settings.supabaseKey || '').trim();
  if (!baseUrl || !apiKey) {
    throw new Error(bt('import.err.needSupabase'));
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
      throw new Error(bt('err.supabaseDelete', { status: response.status }));
    }
  }
}

function getStatsPeriodRange(period) {
  const now = new Date();
  const calendarMatch = String(period || '').match(/^calendar-(\d{4})$/);

  if (calendarMatch) {
    const year = Number(calendarMatch[1]);
    const start = new Date(year, 0, 1, 0, 0, 0, 0);
    const end = year === now.getFullYear()
      ? now
      : new Date(year, 11, 31, 23, 59, 59, 999);
    return { from: start.toISOString(), to: end.toISOString(), start, end };
  }

  const end = now;
  const start = new Date(now);

  if (period === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'quarter') {
    start.setMonth(start.getMonth() - 3, start.getDate());
    start.setHours(0, 0, 0, 0);
  } else if (period === 'half') {
    start.setMonth(start.getMonth() - 5, 1);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'year') {
    // Přesně 12 kalendářních měsíců včetně aktuálního (ne 13).
    start.setMonth(start.getMonth() - 11, 1);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
  }

  return { from: start.toISOString(), to: end.toISOString(), start, end };
}

async function getUsageStats(period = '30d') {
  const settings = await getExtensionSettings();
  const baseUrl = String(settings.supabaseUrl || '').replace(/\/$/, '');
  const apiKey = String(settings.supabaseKey || '').trim();
  if (!baseUrl || !apiKey) {
    throw new Error(bt('import.err.needSupabase'));
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
    throw new Error(bt('err.supabaseHttp', { status: response.status }));
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
  const settings = await getExtensionSettings();
  const baseUrl = String(settings.supabaseUrl || '').replace(/\/$/, '');
  const apiKey = String(settings.supabaseKey || '').trim();
  if (!baseUrl || !apiKey) {
    throw new Error(bt('import.err.needSupabase'));
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
  // Automatické sondy LingQ při nečinnosti jen v admin buildu.
  if (typeof isAdminBuild !== 'function' || !isAdminBuild()) {
    await chrome.alarms.clear(LATENCY_ALARM);
    return;
  }
  const settings = await getExtensionSettings({ latencyIdleSeconds: 60 });
  const hasSites = Array.isArray(settings.enabledSites) && settings.enabledSites.length > 0;
  if (!hasSites || !isLingqEnabled(settings) || !isSupabaseConfigured(settings)) {
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
  if (typeof isAdminBuild !== 'function' || !isAdminBuild()) {
    await chrome.alarms.clear(LATENCY_ALARM);
    return;
  }
  const settings = await getExtensionSettings({ latencyIdleSeconds: 60 });
  const hasSites = Array.isArray(settings.enabledSites) && settings.enabledSites.length > 0;
  if (!hasSites || !isLingqEnabled(settings) || !isSupabaseConfigured(settings)) {
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
  if (typeof isAdminBuild !== 'function' || !isAdminBuild()) {
    await chrome.alarms.clear(LATENCY_ALARM);
    return;
  }
  const settings = await getExtensionSettings({ latencyIdleSeconds: 60 });
  const hasSites = Array.isArray(settings.enabledSites) && settings.enabledSites.length > 0;
  if (!hasSites || !isSupabaseConfigured(settings)) {
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
    const settings = await getExtensionSettings();
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
  const status = Number(result.status);
  if (status === -1) {
    return null;
  }
  if (result.created === true) {
    return 'new';
  }
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
    const settings = await getExtensionSettings();
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
    const settings = await getExtensionSettings();
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
    return { error: bt('import.err.needSupabase') };
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
      return { error: bt('err.latencyTableMissing') };
    }
    throw new Error(bt('err.supabaseHttp', { status: response.status }));
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
  if (typeof fields.needsLingqSync === 'boolean') {
    payload.p_needs_lingq_sync = fields.needsLingqSync;
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
    throw new Error(bt('err.supabaseHttp', { status: response.status }));
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
