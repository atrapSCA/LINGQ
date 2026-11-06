(function initTheme(global) {
  const THEME_KEY = 'theme';
  const DEFAULT_THEME = 'light';

  function normalizeTheme(value) {
    return value === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    const next = normalizeTheme(theme);
    document.documentElement.dataset.theme = next;
    return next;
  }

  function loadTheme(callback) {
    chrome.storage.sync.get({ [THEME_KEY]: DEFAULT_THEME }, (settings) => {
      const theme = applyTheme(settings[THEME_KEY]);
      if (typeof callback === 'function') {
        callback(theme);
      }
    });
  }

  function saveTheme(theme, callback) {
    const next = applyTheme(theme);
    chrome.storage.sync.set({ [THEME_KEY]: next }, () => {
      if (typeof callback === 'function') {
        callback(next);
      }
    });
  }

  function watchTheme(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes[THEME_KEY]) {
        return;
      }
      const theme = applyTheme(changes[THEME_KEY].newValue);
      if (typeof callback === 'function') {
        callback(theme);
      }
    });
  }

  global.LingqTheme = {
    KEY: THEME_KEY,
    DEFAULT: DEFAULT_THEME,
    normalize: normalizeTheme,
    apply: applyTheme,
    load: loadTheme,
    save: saveTheme,
    watch: watchTheme,
  };
}(typeof window !== 'undefined' ? window : self));
