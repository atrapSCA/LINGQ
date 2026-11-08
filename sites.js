/**
 * Per-site allowlist — chrome.storage.sync.enabledSites (bez DB).
 * Sdílené: background (importScripts), popup/app/content (script tag).
 */
(function initLingqSites(global) {
  function normalizeSiteHost(hostname) {
    const host = String(hostname || '')
      .trim()
      .toLowerCase()
      .replace(/\.+$/, '');
    if (!host || host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      return host;
    }
    return host.replace(/^www\./, '');
  }

  function siteKeyFromUrl(url) {
    try {
      const parsed = new URL(String(url || ''));
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return '';
      }
      return normalizeSiteHost(parsed.hostname);
    } catch {
      return '';
    }
  }

  function isHostEnabled(host, enabledSites) {
    const normalized = normalizeSiteHost(host);
    if (!normalized) {
      return false;
    }
    const list = Array.isArray(enabledSites) ? enabledSites : [];
    return list.some((entry) => {
      const site = normalizeSiteHost(entry);
      if (!site) {
        return false;
      }
      return normalized === site || normalized.endsWith(`.${site}`);
    });
  }

  function findMatchingSiteKey(host, enabledSites) {
    const normalized = normalizeSiteHost(host);
    if (!normalized) {
      return '';
    }
    const list = Array.isArray(enabledSites) ? enabledSites : [];
    let best = '';
    list.forEach((entry) => {
      const site = normalizeSiteHost(entry);
      if (!site) {
        return;
      }
      if (normalized === site || normalized.endsWith(`.${site}`)) {
        if (site.length > best.length) {
          best = site;
        }
      }
    });
    return best;
  }

  function addEnabledSite(enabledSites, siteKey) {
    const key = normalizeSiteHost(siteKey);
    if (!key) {
      return Array.isArray(enabledSites) ? [...enabledSites] : [];
    }
    const list = Array.isArray(enabledSites) ? enabledSites.map(normalizeSiteHost).filter(Boolean) : [];
    if (list.some((site) => key === site || key.endsWith(`.${site}`))) {
      return list;
    }
    // Odstraň redundantní subdomény, které nový klíč pokrývá.
    const next = list.filter((site) => site !== key && !site.endsWith(`.${key}`));
    next.push(key);
    next.sort();
    return next;
  }

  function removeEnabledSite(enabledSites, hostOrKey) {
    const match = findMatchingSiteKey(hostOrKey, enabledSites) || normalizeSiteHost(hostOrKey);
    if (!match) {
      return Array.isArray(enabledSites) ? [...enabledSites] : [];
    }
    return (Array.isArray(enabledSites) ? enabledSites : [])
      .map(normalizeSiteHost)
      .filter((site) => site && site !== match);
  }

  const api = {
    normalizeSiteHost,
    siteKeyFromUrl,
    isHostEnabled,
    findMatchingSiteKey,
    addEnabledSite,
    removeEnabledSite,
  };

  global.LingqSites = api;
})(typeof self !== 'undefined' ? self : globalThis);
