(function initI18n(global) {
  const LOCALE_KEY = 'uiLocale';
  const DEFAULT_LOCALE = 'en';
  const LOCALES = ['cs', 'en', 'de', 'fr', 'es'];

  /** @type {Record<string, Record<string, string>>} */
  const catalogs = Object.create(null);
  let currentLocale = DEFAULT_LOCALE;

  function normalizeLocale(value) {
    const code = String(value || '').toLowerCase();
    return LOCALES.includes(code) ? code : DEFAULT_LOCALE;
  }

  function localeUrl(locale) {
    return chrome.runtime.getURL(`locales/${locale}.json`);
  }

  async function fetchCatalog(locale) {
    const code = normalizeLocale(locale);
    if (catalogs[code]) {
      return catalogs[code];
    }
    const response = await fetch(localeUrl(code));
    if (!response.ok) {
      throw new Error(`Locale "${code}" failed to load (${response.status}).`);
    }
    const data = await response.json();
    catalogs[code] = data && typeof data === 'object' ? data : {};
    return catalogs[code];
  }

  async function ensureCatalog(locale) {
    const code = normalizeLocale(locale);
    await fetchCatalog(DEFAULT_LOCALE);
    if (code !== DEFAULT_LOCALE) {
      try {
        await fetchCatalog(code);
      } catch (error) {
        console.warn('[LingqI18n]', error);
      }
    }
    return code;
  }

  function t(key, vars) {
    const table = catalogs[currentLocale] || {};
    const fallback = catalogs[DEFAULT_LOCALE] || {};
    let text = table[key] ?? fallback[key] ?? key;
    if (vars && typeof vars === 'object') {
      Object.keys(vars).forEach((name) => {
        text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(vars[name]));
      });
    }
    return text;
  }

  function applyToElement(el) {
    const key = el.getAttribute('data-i18n');
    if (key) {
      if (el.hasAttribute('data-i18n-html')) {
        el.innerHTML = t(key);
      } else {
        el.textContent = t(key);
      }
    }
    [
      ['data-i18n-placeholder', 'placeholder'],
      ['data-i18n-title', 'title'],
      ['data-i18n-aria-label', 'aria-label'],
      ['data-i18n-alt', 'alt'],
      ['data-i18n-value', 'value'],
    ].forEach(([dataAttr, attrName]) => {
      const attrKey = el.getAttribute(dataAttr);
      if (attrKey) {
        el.setAttribute(attrName, t(attrKey));
      }
    });
  }

  function apply(root) {
    if (typeof document === 'undefined') {
      return;
    }
    const scope = root || document;
    scope
      .querySelectorAll('[data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-aria-label], [data-i18n-alt], [data-i18n-value]')
      .forEach(applyToElement);
    document.documentElement.lang = currentLocale;
  }

  async function setLocale(locale, options = {}) {
    const code = await ensureCatalog(locale);
    currentLocale = code;
    if (options.apply !== false && typeof document !== 'undefined') {
      apply(options.root || document);
    }
    return currentLocale;
  }

  function load(callback) {
    chrome.storage.sync.get({ [LOCALE_KEY]: DEFAULT_LOCALE }, (settings) => {
      setLocale(settings[LOCALE_KEY])
        .then((locale) => {
          if (typeof callback === 'function') {
            callback(locale);
          }
        })
        .catch((error) => {
          console.error('[LingqI18n]', error);
          currentLocale = DEFAULT_LOCALE;
          if (typeof callback === 'function') {
            callback(currentLocale);
          }
        });
    });
  }

  function loadAsync() {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get({ [LOCALE_KEY]: DEFAULT_LOCALE }, (settings) => {
        setLocale(settings[LOCALE_KEY], { apply: typeof document !== 'undefined' })
          .then(resolve)
          .catch(reject);
      });
    });
  }

  function save(locale, callback) {
    setLocale(locale)
      .then((code) => {
        chrome.storage.sync.set({ [LOCALE_KEY]: code }, () => {
          if (typeof callback === 'function') {
            callback(code);
          }
        });
      })
      .catch((error) => {
        console.error('[LingqI18n]', error);
        if (typeof callback === 'function') {
          callback(currentLocale);
        }
      });
  }

  function watch(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes[LOCALE_KEY]) {
        return;
      }
      setLocale(changes[LOCALE_KEY].newValue)
        .then((locale) => {
          if (typeof callback === 'function') {
            callback(locale);
          }
        })
        .catch((error) => console.error('[LingqI18n]', error));
    });
  }

  global.LingqI18n = {
    KEY: LOCALE_KEY,
    DEFAULT: DEFAULT_LOCALE,
    LOCALES,
    get MESSAGES() {
      return catalogs;
    },
    t,
    apply,
    setLocale,
    getLocale: () => currentLocale,
    normalize: normalizeLocale,
    ensureCatalog,
    load,
    loadAsync,
    save,
    watch,
  };
}(typeof window !== 'undefined' ? window : self));
