/**
 * Sdílená detekce „import běží / lockuje podbarvení“.
 */
(function initLingqImportLock(global) {
  function isImportLockingHighlight(progress) {
    if (!progress || progress.phase === 'done') {
      return false;
    }
    return Boolean(progress.autoContinue)
      || Boolean(progress.running)
      || (Number(progress.importedCards) || 0) > 0
      || (Number(progress.knownImported) || 0) > 0
      || (Number(progress.cooldownUntil) || 0) > Date.now();
  }

  global.isImportLockingHighlight = isImportLockingHighlight;
  global.LingqImportLock = { isImportLockingHighlight };
})(typeof self !== 'undefined' ? self : globalThis);
