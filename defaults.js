/**
 * Sdílené DEFAULTS + secrets helpers (sync prefs / local keys).
 */
(function initLingqDefaults(global) {
  const DEFAULTS = {
    apiKey: '',
    language: 'en',
    targetLanguage: 'cs',
    enabledSites: [],
    theme: 'light',
    uiLocale: 'en',
    clickCount: 2,
    latencyIdleMinSeconds: 60,
    latencyIdleMaxSeconds: 80,
    chatgptApiKey: '',
    chatgptApiKeyValid: false,
    chatgptEnabled: true,
    chatgptModel: 'gpt-5-nano',
    alternativesSource: 'lingq',
    newWordTranslationSource: 'lingq',
    phraseTranslationSource: 'lingq',
    lingqEnabled: true,
    supabaseEnabled: true,
    supabaseUrl: '',
    supabaseKey: '',
    highlightEnabled: true,
  };

  const SECRET_KEYS = ['apiKey', 'chatgptApiKey', 'chatgptApiKeyValid', 'supabaseKey'];

  const CHATGPT_MODELS = {
    'gpt-5-nano': { inputPerMillion: 0.05, outputPerMillion: 0.40, input: '0.05', output: '0.40' },
    'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60, input: '0.15', output: '0.60' },
    'gpt-5.4-nano': { inputPerMillion: 0.20, outputPerMillion: 1.25, input: '0.20', output: '1.25' },
    'gpt-5-mini': { inputPerMillion: 0.25, outputPerMillion: 2.00, input: '0.25', output: '2.00' },
    'gpt-4.1-mini': { inputPerMillion: 0.40, outputPerMillion: 1.60, input: '0.40', output: '1.60' },
  };

  const CHATGPT_MODEL_IDS = Object.keys(CHATGPT_MODELS);

  function pickSecrets(source) {
    const out = {};
    SECRET_KEYS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(source || {}, key)) {
        out[key] = source[key];
      }
    });
    return out;
  }

  function omitSecrets(source) {
    const out = { ...(source || {}) };
    SECRET_KEYS.forEach((key) => {
      delete out[key];
    });
    return out;
  }

  function syncDefaults() {
    return omitSecrets(DEFAULTS);
  }

  function localSecretDefaults() {
    return pickSecrets(DEFAULTS);
  }

  function resolveChatgptModel(settingsOrModel) {
    const model = typeof settingsOrModel === 'string'
      ? String(settingsOrModel || '').trim()
      : String(settingsOrModel?.chatgptModel || '').trim();
    return Object.prototype.hasOwnProperty.call(CHATGPT_MODELS, model) ? model : DEFAULTS.chatgptModel;
  }

  let migratePromise = null;

  async function getExtensionSettings(extra = {}) {
    await migrateSecretsAndLegacy();
    const extraPrefs = omitSecrets(extra);
    const [sync, local] = await Promise.all([
      chrome.storage.sync.get({ ...syncDefaults(), ...extraPrefs }),
      chrome.storage.local.get(localSecretDefaults()),
    ]);
    return {
      ...DEFAULTS,
      ...extraPrefs,
      ...sync,
      ...local,
    };
  }

  async function setExtensionSecrets(partial) {
    const secrets = pickSecrets(partial);
    if (!Object.keys(secrets).length) {
      return;
    }
    await chrome.storage.local.set(secrets);
  }

  async function setExtensionPrefs(partial) {
    const prefs = omitSecrets(partial);
    if (!Object.keys(prefs).length) {
      return;
    }
    await chrome.storage.sync.set(prefs);
  }

  /** Migrace: klíče ze sync → local; smazat ze sync + legacy `enabled`. */
  async function migrateSecretsAndLegacy() {
    if (migratePromise) {
      return migratePromise;
    }
    migratePromise = (async () => {
      const syncAll = await chrome.storage.sync.get(null);
      const localAll = await chrome.storage.local.get(SECRET_KEYS);
      const toLocal = {};
      const removeFromSync = [];

      SECRET_KEYS.forEach((key) => {
        const syncHas = Object.prototype.hasOwnProperty.call(syncAll, key);
        const localHas = Object.prototype.hasOwnProperty.call(localAll, key);
        if (!syncHas) {
          return;
        }
        if (!localHas) {
          toLocal[key] = syncAll[key];
        }
        removeFromSync.push(key);
      });

      if (Object.keys(toLocal).length) {
        await chrome.storage.local.set(toLocal);
      }
      if (removeFromSync.length) {
        await chrome.storage.sync.remove(removeFromSync);
      }
      if (Object.prototype.hasOwnProperty.call(syncAll, 'enabled')) {
        await chrome.storage.sync.remove('enabled');
      }
      if (!Array.isArray(syncAll.enabledSites)) {
        await chrome.storage.sync.set({ enabledSites: [] });
      }
    })();
    try {
      await migratePromise;
    } catch (error) {
      migratePromise = null;
      throw error;
    }
  }

  const api = {
    DEFAULTS,
    SECRET_KEYS,
    CHATGPT_MODELS,
    CHATGPT_MODEL_IDS,
    syncDefaults,
    localSecretDefaults,
    pickSecrets,
    omitSecrets,
    resolveChatgptModel,
    getExtensionSettings,
    setExtensionSecrets,
    setExtensionPrefs,
    migrateSecretsAndLegacy,
  };

  global.LingqDefaults = api;
  // Pohodlné globály pro background / app (stejná jména jako dřív).
  global.DEFAULTS = DEFAULTS;
  global.CHATGPT_MODELS = CHATGPT_MODELS;
  global.CHATGPT_MODEL_IDS = CHATGPT_MODEL_IDS;
  global.CHATGPT_MODEL_PRICES = CHATGPT_MODELS;
  global.resolveChatgptModel = resolveChatgptModel;
  global.getExtensionSettings = getExtensionSettings;
  global.setExtensionSecrets = setExtensionSecrets;
  global.setExtensionPrefs = setExtensionPrefs;
  global.migrateSecretsAndLegacy = migrateSecretsAndLegacy;
})(typeof self !== 'undefined' ? self : globalThis);
