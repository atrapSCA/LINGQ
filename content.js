const TOOLTIP_ID = 'lingq-click-translator-tooltip';
const WORD_PATTERN = /[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'’\-]*/u;
const STATUS_LEVELS = [
  { value: -1, kind: 'ignored', label: 'I' },
  { value: 1, kind: 'level', label: '1' },
  { value: 2, kind: 'level', label: '2' },
  { value: 3, kind: 'level', label: '3' },
  { value: 4, kind: 'level', label: '4' },
  { value: 5, kind: 'known', label: 'K' },
];
const LEVEL_ICON_IGNORED = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 6c3.79 0 7.17 2.13 8.82 5.5-.59 1.22-1.42 2.27-2.41 3.12l1.41 1.41c1.39-1.23 2.49-2.77 3.18-4.53L23 12l-.01-.24C21.27 7.11 16.99 4 12 4c-1.27 0-2.49.2-3.64.57l1.65 1.65C10.66 6.09 11.32 6 12 6zm-9.83.13L2.1 6.2l1.55 1.55C2.66 9.03 1.7 10.4 1.01 11.76L1 12l.01.24C2.73 16.89 7.01 20 12 20c1.61 0 3.14-.31 4.55-.88l1.64 1.64 1.41-1.41L3.58 4.72 2.17 6.13zM12 18c-3.79 0-7.17-2.13-8.82-5.5.7-1.43 1.76-2.64 3.05-3.53l1.61 1.61c-.3.43-.47.94-.47 1.48 0 1.66 1.34 3 3 3 .54 0 1.05-.17 1.48-.47l1.56 1.56c-.74.28-1.53.43-2.41.43zm2.97-4.85-2.12-2.12c.1-.05.2-.09.32-.12.66-.15 1.36.02 1.88.54.52.52.69 1.22.54 1.88-.03.12-.07.22-.12.32z"/></svg>';
const LEVEL_ICON_KNOWN = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M9.2 16.6 4.8 12.2l1.4-1.4 3 3 8-8 1.4 1.4z"/></svg>';
const USER_PHRASE_WORD_LIMIT = 10;
const HIGHLIGHT_CLASS = 'lingq-hl';
const HIGHLIGHT_SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
  'CODE', 'PRE', 'SVG', 'MATH', 'IFRAME', 'OBJECT', 'VIDEO', 'AUDIO', 'CANVAS',
  'HEAD', 'TITLE', 'META', 'LINK', 'BR', 'HR', 'IMG', 'PICTURE', 'SOURCE',
  'A',
]);
let siteEnabled = false;
let enabledSites = [];
let highlightEnabled = true;
let clickCount = 2;
let sourceLanguage = 'en';
let targetLanguage = 'cs';
let uiTheme = 'light';
let phraseTranslationSource = 'lingq';
let activeRequest = 0;
let phraseSelectionActive = false;
let tooltip;
let highlightMap = Object.create(null);
let highlightRunId = 0;
let highlightMutationTimer = 0;
let highlightObserver = null;
let highlightApplying = false;
let highlightBusyEl = null;
let highlightBusyShowTimer = 0;
let highlightBusyToken = 0;
let loadingHintTimers = [];

let i18nReady = Promise.resolve();

function t(key, vars) {
  return typeof LingqI18n !== 'undefined' ? LingqI18n.t(key, vars) : key;
}

async function ensureI18n() {
  try {
    await i18nReady;
  } catch {
    // keep keys as last resort
  }
}

if (typeof LingqI18n !== 'undefined') {
  i18nReady = LingqI18n.loadAsync();
  LingqI18n.watch(() => {});
}

function normalizeUiTheme(value) {
  return value === 'dark' ? 'dark' : 'light';
}

function applyTooltipTheme() {
  if (tooltip) {
    tooltip.dataset.theme = uiTheme;
  }
}

function normalizePhraseSource(value) {
  return value === 'chatgpt' ? 'chatgpt' : 'lingq';
}

function recomputeSiteEnabled(sites) {
  enabledSites = Array.isArray(sites) ? sites : [];
  const host = typeof LingqSites !== 'undefined'
    ? LingqSites.normalizeSiteHost(location.hostname)
    : String(location.hostname || '').toLowerCase();
  siteEnabled = typeof LingqSites !== 'undefined'
    ? LingqSites.isHostEnabled(host, enabledSites)
    : false;
}

chrome.storage.sync.get({
  enabledSites: [],
  highlightEnabled: true,
  clickCount: 2,
  language: 'en',
  targetLanguage: 'cs',
  theme: 'light',
  phraseTranslationSource: 'lingq',
  lingqEnabled: true,
}, (settings) => {
  recomputeSiteEnabled(settings.enabledSites);
  highlightEnabled = settings.highlightEnabled !== false;
  clickCount = Number(settings.clickCount) === 2 ? 2 : 1;
  sourceLanguage = settings.language || 'en';
  targetLanguage = settings.targetLanguage || 'cs';
  uiTheme = normalizeUiTheme(settings.theme);
  phraseTranslationSource = settings.lingqEnabled === false
    ? 'chatgpt'
    : normalizePhraseSource(settings.phraseTranslationSource);
  applyTooltipTheme();
  refreshImportBannerFromStorage();
  schedulePageHighlight();
});

function ensureImportBannerEl() {
  let el = document.getElementById('lingq-import-banner');
  if (el?.isConnected) {
    return el;
  }
  el = document.createElement('div');
  el.id = 'lingq-import-banner';
  el.setAttribute('role', 'status');
  el.hidden = true;
  el.textContent = '';
  (document.documentElement || document.body).appendChild(el);
  return el;
}

async function renderImportBanner(progress) {
  const locked = isImportLockingHighlight(progress);
  const el = ensureImportBannerEl();
  if (!locked) {
    el.hidden = true;
    el.classList.remove('lingq-import-banner--visible');
    return;
  }
  await ensureI18n();
  el.textContent = t('content.importBanner');
  el.hidden = false;
  el.classList.add('lingq-import-banner--visible');
}

function refreshImportBannerFromStorage() {
  chrome.storage.local.get('knownWordsSync', (stored) => {
    renderImportBanner(stored.knownWordsSync || null).catch(() => {});
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.knownWordsSync) {
    renderImportBanner(changes.knownWordsSync.newValue || null);
    schedulePageHighlight({ force: true });
    return;
  }
  if (areaName !== 'sync') {
    return;
  }
  if (changes.enabledSites) {
    recomputeSiteEnabled(changes.enabledSites.newValue);
    if (!siteEnabled) {
      hideTooltip();
      clearPageHighlights();
      stopHighlightObserver();
    }
    schedulePageHighlight({ force: true });
  }
  if (changes.highlightEnabled) {
    highlightEnabled = changes.highlightEnabled.newValue !== false;
    schedulePageHighlight({ force: true });
  }
  if (changes.clickCount) {
    clickCount = Number(changes.clickCount.newValue) === 2 ? 2 : 1;
  }
  if (changes.language) {
    sourceLanguage = changes.language.newValue || 'en';
    schedulePageHighlight({ force: true });
  }
  if (changes.targetLanguage) {
    targetLanguage = changes.targetLanguage.newValue || 'cs';
  }
  if (changes.theme) {
    uiTheme = normalizeUiTheme(changes.theme.newValue);
    applyTooltipTheme();
  }
  if (changes.supabaseEnabled || changes.supabaseUrl) {
    schedulePageHighlight({ force: true });
  }
  if (changes.phraseTranslationSource || changes.lingqEnabled) {
    chrome.storage.sync.get({
      phraseTranslationSource: 'lingq',
      lingqEnabled: true,
    }, (settings) => {
      phraseTranslationSource = settings.lingqEnabled === false
        ? 'chatgpt'
        : normalizePhraseSource(settings.phraseTranslationSource);
    });
  }
});

document.addEventListener('mouseup', handlePhraseSelection, true);
document.addEventListener('click', handleClick, true);
window.addEventListener('scroll', hideTooltip, { passive: true });
window.addEventListener('resize', hideTooltip, { passive: true });

document.addEventListener('click', (event) => {
  if (phraseSelectionActive) {
    return;
  }
  const target = event.target;
  if (target instanceof Element && !target.closest(`#${TOOLTIP_ID}`)) {
    hideTooltip();
  }
}, false);

async function handlePhraseSelection(event) {
  // Syntetické eventy ze stránky (dispatchEvent) ignorujeme — běžné kliknutí uživatele projde.
  if (!event.isTrusted || !siteEnabled || event.button !== 0) {
    return;
  }

  const target = event.target;
  if (!(target instanceof Element) || target.closest(`#${TOOLTIP_ID}`) || target.closest('input, textarea, select, [contenteditable="true"]')) {
    return;
  }

  const selected = getSelectedPhrase();
  if (!selected) {
    return;
  }

  phraseSelectionActive = true;
  window.setTimeout(() => {
    phraseSelectionActive = false;
  }, 0);

  await ensureI18n();

  const isAdmin = typeof isAdminBuild === 'function' && isAdminBuild();
  const phraseViaChatgpt = phraseTranslationSource === 'chatgpt';
  // Limit 10 slov platí jen v user buildu při překladu přes LingQ.
  if (!isAdmin && !phraseViaChatgpt && selected.wordCount > USER_PHRASE_WORD_LIMIT) {
    showPhraseTooltip(
      selected.text,
      selected.rect,
      t('bubble.phraseLimit', { n: selected.wordCount, limit: USER_PHRASE_WORD_LIMIT }),
      'external',
    );
    return;
  }

  const requestId = ++activeRequest;
  const clickedAt = Date.now();
  showPhraseTooltip(selected.text, selected.rect, t('bubble.translatingPhrase'), 'loading');
  startLoadingHints(requestId, 'phrase');
  chrome.runtime.sendMessage({ type: 'TRANSLATE_PHRASE', text: selected.text, clickedAt }, (response) => {
    if (requestId !== activeRequest) {
      return;
    }
    clearLoadingHints();
    if (chrome.runtime.lastError || !response?.ok) {
      showPhraseTooltip(selected.text, selected.rect, response?.error || t('bubble.phraseFailed'), 'error');
      return;
    }
    showPhraseTooltip(selected.text, selected.rect, response.translation, 'ready');
  });
}

function handleClick(event) {
  if (!event.isTrusted) {
    return;
  }

  if (phraseSelectionActive) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (!siteEnabled || event.button !== 0) {
    return;
  }

  const target = event.target;
  if (!(target instanceof Element) || target.closest(`#${TOOLTIP_ID}`)) {
    return;
  }

  const anchor = target.closest('a');
  const wantsDoubleClick = clickCount === 2;
  if (anchor) {
    if (event.detail === 2) {
      event.preventDefault();
      event.stopPropagation();
      lookupFromPoint(event.clientX, event.clientY, target, event);
    }
    return;
  }

  if (event.detail !== (wantsDoubleClick ? 2 : 1)) {
    return;
  }

  lookupFromPoint(event.clientX, event.clientY, target, event);
}

async function lookupFromPoint(clientX, clientY, target, event) {
  const clickedAt = Date.now();
  const selection = getWordSelection(clientX, clientY, target);
  if (!selection) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  await ensureI18n();
  const requestId = ++activeRequest;
  showTooltip(selection.word, selection.rect, t('bubble.translatingWord'), 'loading', 0, null, []);
  startLoadingHints(requestId, 'word');

  chrome.runtime.sendMessage({ type: 'LOOKUP_WORD', word: selection.word, clickedAt }, (response) => {
    if (requestId !== activeRequest) {
      return;
    }
    clearLoadingHints();
    if (chrome.runtime.lastError || !response?.ok) {
      showTooltip(selection.word, selection.rect, response?.error || t('bubble.lingqFailed'), 'error', 0, null, []);
      return;
    }
    // Modrá jen u nově založeného / dosud nesledovaného slova — ne u znalosti 1–4, K ani I.
    const statusNum = Number(response.status);
    const hasTrackedStatus = statusNum === -1 || (statusNum >= 1 && statusNum <= 5);
    const kind = (
      response.created === true
      || (response.unknown === true && !hasTrackedStatus)
    ) ? 'unknown' : 'known';
    showTooltip(
      selection.word,
      selection.rect,
      response.translation,
      kind,
      response.status,
      response.cardId,
      response.translations || [response.translation],
      response.viewCount || null,
      response.alternativesSource || 'lingq',
    );
    if (Number.isFinite(Number(response.status)) && (Number(response.status) > 0 || Number(response.status) === -1)) {
      updateHighlightForWord(selection.word, Number(response.status));
    }
  });
}

function getSelectedPhrase() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const text = selection.toString().replace(/\s+/g, ' ').trim();
  const words = text.match(/[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'’\-]*/gu) || [];
  if (words.length < 2) {
    return null;
  }

  const range = selection.getRangeAt(0);
  return {
    text: text.slice(0, 2000),
    wordCount: words.length,
    rect: range.getBoundingClientRect(),
  };
}

function showPhraseTooltip(sentence, rect, translation, state) {
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = TOOLTIP_ID;
    tooltip.setAttribute('role', 'status');
    document.documentElement.appendChild(tooltip);
  }

  applyTooltipTheme();
  const canCopyTranslation = state === 'ready';
  tooltip.className = `lingq-tooltip lingq-tooltip--phrase lingq-tooltip--phrase-${state}`;
  tooltip.dataset.sentence = sentence;
  tooltip.dataset.cardId = '';
  tooltip.dataset.translation = canCopyTranslation ? translation : '';
  tooltip.innerHTML = `
    <div class="lingq-tooltip__top">
      <span class="lingq-tooltip__sentence"></span>
      <button class="lingq-tooltip__close" type="button" aria-label="${t('bubble.close')}">×</button>
    </div>
    <span class="lingq-tooltip__phrase-translation"></span>
    <div class="lingq-tooltip__actions"></div>
  `;
  tooltip.querySelector('.lingq-tooltip__sentence').textContent = sentence;
  const phraseTranslation = tooltip.querySelector('.lingq-tooltip__phrase-translation');
  if (state === 'loading') {
    fillLoadingTranslation(phraseTranslation, translation);
  } else {
    phraseTranslation.textContent = translation;
  }
  tooltip.querySelector('.lingq-tooltip__close').addEventListener('click', hideTooltip);

  const actions = tooltip.querySelector('.lingq-tooltip__actions');
  if (state === 'external') {
    const openButton = document.createElement('a');
    openButton.className = 'lingq-tooltip__copy lingq-tooltip__copy--link';
    openButton.href = buildTranslatorUrl(sentence);
    openButton.target = '_blank';
    openButton.rel = 'noopener noreferrer';
    openButton.textContent = t('bubble.openTranslator');
    openButton.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    actions.appendChild(openButton);
  }

  appendCopyButtons(actions, {
    original: sentence,
    translation: canCopyTranslation ? translation : '',
    showTranslation: canCopyTranslation,
  });

  placeTooltip(rect);
}

function buildTranslatorUrl(text) {
  const params = new URLSearchParams({
    sl: sourceLanguage || 'auto',
    tl: targetLanguage || 'cs',
    text: String(text || ''),
    op: 'translate',
  });
  return `https://translate.google.com/?${params.toString()}`;
}

function appendCopyButtons(container, options = {}) {
  const original = String(options.original || '');
  const translation = String(options.translation || '');
  const showTranslation = options.showTranslation !== false && Boolean(translation);

  if (original) {
    const originalButton = document.createElement('button');
    originalButton.type = 'button';
    originalButton.className = 'lingq-tooltip__copy';
    originalButton.textContent = t('bubble.copyOriginal');
    originalButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      copyTextToClipboard(original, originalButton, t('bubble.copyOriginal'));
    });
    container.appendChild(originalButton);
  }

  if (showTranslation) {
    const translationButton = document.createElement('button');
    translationButton.type = 'button';
    translationButton.className = 'lingq-tooltip__copy';
    translationButton.textContent = t('bubble.copyTranslation');
    translationButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const liveTranslation = tooltip?.dataset.translation || translation;
      copyTextToClipboard(liveTranslation, translationButton, t('bubble.copyTranslation'));
    });
    container.appendChild(translationButton);
  }
}

function copyTextToClipboard(text, button, idleLabel) {
  const value = String(text || '');
  if (!value) {
    button.textContent = t('bubble.copyEmpty');
    window.setTimeout(() => {
      button.textContent = idleLabel;
    }, 1400);
    return;
  }

  const done = () => {
    button.textContent = t('bubble.copied');
    window.setTimeout(() => {
      button.textContent = idleLabel;
    }, 1400);
  };
  const failed = () => {
    button.textContent = t('bubble.copyFailed');
    window.setTimeout(() => {
      button.textContent = idleLabel;
    }, 1600);
  };
  const fallback = () => {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    if (!copied) {
      failed();
      return;
    }
    done();
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(value).then(done).catch(fallback);
    return;
  }
  fallback();
}

function getWordSelection(clientX, clientY, target) {
  const range = document.caretRangeFromPoint?.(clientX, clientY) || document.caretPositionFromPoint && getRangeFromCaretPosition(clientX, clientY);
  if (!range || !target.contains(range.startContainer)) {
    return null;
  }

  const textNode = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer : range.startContainer.childNodes[range.startOffset];
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
    return null;
  }

  const text = textNode.textContent || '';
  const offset = range.startOffset;
  const wordStart = findWordStart(text, offset);
  const wordEnd = findWordEnd(text, offset);
  const word = text.slice(wordStart, wordEnd).match(WORD_PATTERN)?.[0];
  if (!word || !hasLetter(word)) {
    return null;
  }

  const wordRange = document.createRange();
  wordRange.setStart(textNode, wordStart);
  wordRange.setEnd(textNode, wordEnd);
  return { word, rect: wordRange.getBoundingClientRect() };
}

function getRangeFromCaretPosition(clientX, clientY) {
  const position = document.caretPositionFromPoint(clientX, clientY);
  if (!position) {
    return null;
  }
  const range = document.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);
  return range;
}

function findWordStart(text, offset) {
  let index = Math.min(offset, text.length - 1);
  while (index > 0 && isWordCharacter(text[index - 1])) index -= 1;
  return index;
}

function findWordEnd(text, offset) {
  let index = Math.max(offset, 0);
  while (index < text.length && isWordCharacter(text[index])) index += 1;
  return index;
}

function isWordCharacter(character) {
  return /[\p{L}\p{M}\p{N}'’\-]/u.test(character);
}

/** Čísla bez písmen (60, 2024…) nepodbarvovat ani neotvírat bublinu. */
function hasLetter(word) {
  return /\p{L}/u.test(String(word || ''));
}

function showTooltip(word, rect, translation, kind, status, cardId, translations, viewCount = null, alternativesSource = 'lingq') {
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = TOOLTIP_ID;
    tooltip.setAttribute('role', 'status');
    document.documentElement.appendChild(tooltip);
  }

  applyTooltipTheme();
  tooltip.className = `lingq-tooltip lingq-tooltip--${kind}`;
  tooltip.dataset.word = word;
  tooltip.dataset.translation = kind === 'loading' || kind === 'error' ? '' : translation;
  tooltip.dataset.cardId = cardId ? String(cardId) : '';
  const source = alternativesSource === 'chatgpt' ? 'chatgpt' : 'lingq';
  tooltip.dataset.alternativesSource = source;
  tooltip.dataset.alternativesLoaded = 'false';
  tooltip.innerHTML = `<div class="lingq-tooltip__top"><span class="lingq-tooltip__word"></span><button class="lingq-tooltip__close" type="button" aria-label="${t('bubble.close')}">×</button></div><span class="lingq-tooltip__translation"></span><span class="lingq-tooltip__views" hidden></span><div class="lingq-tooltip__levels" role="group" aria-label="${t('bubble.knowledgeGroup')}"></div><button class="lingq-tooltip__alternatives" type="button"></button><div class="lingq-tooltip__alternative-list" hidden></div><div class="lingq-tooltip__actions" hidden></div><span class="lingq-tooltip__message" role="status"></span>`;
  tooltip.querySelector('.lingq-tooltip__word').textContent = word;
  const translationElement = tooltip.querySelector('.lingq-tooltip__translation');
  if (kind === 'loading') {
    fillLoadingTranslation(translationElement, translation);
  } else {
    translationElement.textContent = translation;
  }
  const viewsElement = tooltip.querySelector('.lingq-tooltip__views');
  const seenCount = Number(viewCount);
  if (Number.isInteger(seenCount) && seenCount > 1 && kind !== 'loading' && kind !== 'error') {
    viewsElement.hidden = false;
    viewsElement.textContent = t('bubble.seen', { n: seenCount });
  }
  if (kind !== 'loading' && kind !== 'error') {
    enableTranslationEditing(translationElement);
  }
  tooltip.querySelector('.lingq-tooltip__close').addEventListener('click', hideTooltip);

  const levels = tooltip.querySelector('.lingq-tooltip__levels');
  if (kind !== 'loading' && kind !== 'error') {
    STATUS_LEVELS.forEach((level) => {
      levels.appendChild(createLevelButton(level, Number(status)));
    });
  }

  const alternativeButton = tooltip.querySelector('.lingq-tooltip__alternatives');
  const alternativeList = tooltip.querySelector('.lingq-tooltip__alternative-list');
  const canShowAlternatives = kind !== 'loading' && kind !== 'error';
  if (!canShowAlternatives) {
    alternativeButton.hidden = true;
  } else {
    alternativeButton.hidden = false;
    alternativeButton.textContent = alternativesButtonLabel(source, 'show');
    // API (LingQ / ChatGPT) se volá až po kliknutí — nic se nenačítá předem.
    alternativeButton.addEventListener('click', (event) => {
      if (!event.isTrusted) {
        return;
      }
      if (tooltip.dataset.alternativesLoaded !== 'true') {
        loadAlternativeTranslations(word, translation, alternativeButton, alternativeList, translationElement, rect);
        return;
      }
      alternativeList.hidden = !alternativeList.hidden;
      alternativeButton.textContent = alternativesButtonLabel(
        tooltip.dataset.alternativesSource,
        alternativeList.hidden ? 'show' : 'hide',
      );
      placeTooltip(rect);
    });
  }

  placeTooltip(rect);
}

function populateAlternativeList(alternativeList, meaningLines, translationElement) {
  alternativeList.innerHTML = '';
  if (meaningLines.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'lingq-tooltip__alternative lingq-tooltip__alternative--empty';
    empty.textContent = t('bubble.altEmpty');
    alternativeList.appendChild(empty);
    return;
  }
  meaningLines.forEach((line) => {
    const item = document.createElement('div');
    item.className = 'lingq-tooltip__alternative';
    const text = document.createElement('span');
    text.className = 'lingq-tooltip__alternative-text';
    text.textContent = line;
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'lingq-tooltip__add';
    addButton.textContent = '+';
    addButton.title = t('bubble.altAdd');
    addButton.setAttribute('aria-label', t('bubble.altAdd'));
    addButton.addEventListener('click', (event) => {
      if (!event.isTrusted) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      addMeaningToTranslation(line, item, translationElement);
    });
    item.append(text, addButton);
    alternativeList.appendChild(item);
  });
}

function fillAlternativeList(alternativeList, meaningLines, translationElement, rect) {
  populateAlternativeList(alternativeList, meaningLines, translationElement);
  alternativeList.hidden = false;
  placeTooltip(rect);
}

function alternativesButtonLabel(source, state = 'show') {
  const api = source === 'chatgpt' ? 'ChatGPT' : 'LingQ';
  if (state === 'loading') {
    return t('bubble.altLoading');
  }
  if (state === 'hide') {
    return t('bubble.altHide');
  }
  return t('bubble.altShow', { api });
}

function friendlyAlternativesError(message) {
  const text = String(message || '');
  if (/message channel closed/i.test(text) || /asynchronous response/i.test(text)) {
    return t('bubble.altTimeout');
  }
  return text || t('bubble.altFailed');
}

function loadAlternativeTranslations(word, translation, alternativeButton, alternativeList, translationElement, rect) {
  const source = tooltip?.dataset.alternativesSource === 'chatgpt' ? 'chatgpt' : 'lingq';
  alternativeButton.disabled = true;
  alternativeButton.textContent = alternativesButtonLabel(source, 'loading');
  alternativeList.hidden = false;
  alternativeList.innerHTML = `<div class="lingq-tooltip__alternative lingq-tooltip__alternative--empty">${t('bubble.altLoadingMore')}</div>`;
  placeTooltip(rect);

  chrome.runtime.sendMessage({
    type: 'GET_ALTERNATIVES',
    word,
    currentTranslation: translation,
  }, (response) => {
    if (!tooltip || tooltip.dataset.word !== word) {
      return;
    }
    alternativeButton.disabled = false;
    if (chrome.runtime.lastError || !response?.ok) {
      alternativeButton.textContent = alternativesButtonLabel(source, 'show');
      alternativeList.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'lingq-tooltip__alternative lingq-tooltip__alternative--empty';
      empty.textContent = friendlyAlternativesError(
        response?.error || chrome.runtime.lastError?.message || t('bubble.altFailed'),
      );
      alternativeList.appendChild(empty);
      placeTooltip(rect);
      return;
    }
    tooltip.dataset.alternativesLoaded = 'true';
    alternativeButton.textContent = alternativesButtonLabel(source, 'hide');
    fillAlternativeList(alternativeList, response.translations || [], translationElement, rect);
  });
}

function groupMeanings(translations, current) {
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
  return lines.filter((line) => !meaningIncluded(current, line));
}

function meaningWords(text) {
  return String(text || '').split(',').map((part) => part.trim()).filter(Boolean);
}

function meaningIncluded(current, line) {
  const have = new Set(meaningWords(current).map((part) => part.toLowerCase()));
  const parts = meaningWords(line);
  if (parts.length === 0) {
    return true;
  }
  return parts.every((part) => have.has(part.toLowerCase()));
}

function mergeMeaning(current, line) {
  const items = [];
  const seen = new Set();
  [...meaningWords(current), ...meaningWords(line)].forEach((part) => {
    const key = part.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    items.push(part);
  });
  return items.join(', ');
}

function addMeaningToTranslation(line, item, translationElement) {
  const cardId = tooltip?.dataset.cardId || '';
  const word = tooltip?.dataset.word || '';
  const current = (translationElement.textContent || '').replace(/\s+/g, ' ').trim();
  const merged = mergeMeaning(current, line);
  if (!merged || merged === current) {
    item.remove();
    return;
  }

  const addButton = item.querySelector('.lingq-tooltip__add');
  if (addButton) {
    addButton.disabled = true;
  }
  translationElement.textContent = merged;
  tooltip.dataset.translation = merged;
  pendingTranslation = merged;
  showTooltipMessage(t('bubble.savingTranslation'));
  chrome.runtime.sendMessage({ type: 'UPDATE_TRANSLATION', cardId, word, translation: merged }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      translationElement.textContent = current;
      tooltip.dataset.translation = current;
      pendingTranslation = '';
      if (addButton) {
        addButton.disabled = false;
      }
      showTooltipMessage(response?.error || t('bubble.saveTranslationFailed'));
      return;
    }
    if (response.cardId) {
      tooltip.dataset.cardId = String(response.cardId);
    }
    const stored = response.translation || merged;
    tooltip.dataset.translation = stored;
    translationElement.textContent = stored;
    pendingTranslation = '';
    item.remove();
    const list = tooltip.querySelector('.lingq-tooltip__alternative-list');
    if (list && list.children.length === 0) {
      list.hidden = true;
      const toggle = tooltip.querySelector('.lingq-tooltip__alternatives');
      if (toggle) {
        toggle.hidden = true;
      }
    }
    showTooltipMessage(t('bubble.translationSaved'));
  });
}

function placeTooltip(rect) {
  tooltip.style.display = 'block';
  const left = Math.max(12, Math.min(window.innerWidth - tooltip.offsetWidth - 12, rect.left + rect.width / 2 - tooltip.offsetWidth / 2));
  const top = rect.top > 110 ? rect.top - tooltip.offsetHeight - 12 : rect.bottom + 12;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${Math.max(12, top)}px`;
}

function enableTranslationEditing(element) {
  element.classList.add('lingq-tooltip__translation--editable');
  element.title = t('bubble.editTranslation');
  element.spellcheck = true;

  element.addEventListener('click', (event) => {
    if (!event.isTrusted) {
      return;
    }
    if (element.getAttribute('contenteditable') === 'true') {
      return;
    }
    element.contentEditable = 'true';
    element.classList.add('lingq-tooltip__translation--editing');
    element.focus();
  });

  element.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      element.blur();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      element.textContent = tooltip.dataset.translation || '';
      element.blur();
    }
  });

  element.addEventListener('input', () => {
    window.clearTimeout(element.saveTimer);
    element.saveTimer = window.setTimeout(() => saveTranslation(element), 700);
  });

  element.addEventListener('blur', () => {
    window.clearTimeout(element.saveTimer);
    element.contentEditable = 'false';
    element.classList.remove('lingq-tooltip__translation--editing');
    saveTranslation(element);
  });
}

let translationSaveRequest = 0;
let pendingTranslation = '';

function saveTranslation(element) {
  const next = (element.textContent || '').replace(/\s+/g, ' ').trim();
  const saved = (tooltip?.dataset.translation || '').trim();
  if (!next) {
    element.textContent = saved;
    return;
  }
  if (next === saved || next === pendingTranslation) {
    return;
  }

  const cardId = tooltip?.dataset.cardId || '';
  const word = tooltip?.dataset.word || '';

  pendingTranslation = next;
  const requestId = ++translationSaveRequest;
  showTooltipMessage(t('bubble.savingTranslation'));
  chrome.runtime.sendMessage({ type: 'UPDATE_TRANSLATION', cardId, word, translation: next }, (response) => {
    if (requestId !== translationSaveRequest) {
      return;
    }
    if (pendingTranslation === next) {
      pendingTranslation = '';
    }
    if (chrome.runtime.lastError || !response?.ok) {
      showTooltipMessage(response?.error || t('bubble.saveTranslationFailed'));
      return;
    }

    if (response.cardId) {
      tooltip.dataset.cardId = String(response.cardId);
    }
    const stored = response.translation || next;
    tooltip.dataset.translation = stored;
    if (element.getAttribute('contenteditable') !== 'true') {
      element.textContent = stored;
    }
    showTooltipMessage(t('bubble.translationSaved'));
  });
}

function levelTitle(level) {
  if (level.kind === 'ignored') {
    return t('bubble.setIgnored');
  }
  if (level.kind === 'known') {
    return t('bubble.setLevel', { level: 'K' });
  }
  return t('bubble.setLevel', { level: level.label });
}

function createLevelButton(level, activeStatus) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.status = String(level.value);
  applyLevelButtonState(button, level, activeStatus);
  button.title = levelTitle(level);
  button.setAttribute('aria-label', levelTitle(level));
  button.addEventListener('click', (event) => {
    if (!event.isTrusted) {
      return;
    }
    changeStatus(level.value);
  });
  return button;
}

function applyLevelButtonState(button, level, activeStatus) {
  const active = Number(activeStatus) === level.value;
  button.className = `lingq-level lingq-level--${level.kind} lingq-level--${active ? 'active' : 'empty'}`;
  if (level.kind === 'ignored') {
    button.innerHTML = LEVEL_ICON_IGNORED;
  } else if (level.kind === 'known') {
    button.innerHTML = LEVEL_ICON_KNOWN;
  } else {
    button.textContent = level.label;
  }
}

function changeStatus(status) {
  const cardId = tooltip?.dataset.cardId || '';
  const word = tooltip?.dataset.word || '';
  const translation = tooltip?.dataset.translation || '';

  const buttons = [...tooltip.querySelectorAll('.lingq-level')];
  buttons.forEach((button) => { button.disabled = true; });
  showTooltipMessage(t('bubble.savingLevel'));

  chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', cardId, status, word, translation }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      buttons.forEach((button) => { button.disabled = false; });
      showTooltipMessage(response?.error || t('bubble.saveLevelFailed'));
      return;
    }

    if (response.cardId) {
      tooltip.dataset.cardId = String(response.cardId);
    }
    buttons.forEach((button, index) => {
      applyLevelButtonState(button, STATUS_LEVELS[index], Number(response.status));
      button.disabled = false;
    });
    showTooltipMessage(t('bubble.levelSaved'));
    updateHighlightForWord(word, Number(response.status));
  });
}

function showTooltipMessage(message) {
  const messageElement = tooltip?.querySelector('.lingq-tooltip__message');
  if (messageElement) {
    messageElement.textContent = message;
  }
}

function fillLoadingTranslation(element, label) {
  if (!element) {
    return;
  }
  element.classList.add('lingq-tooltip__loading');
  element.innerHTML = `
    <span class="lingq-tooltip__spinner" aria-hidden="true"></span>
    <span class="lingq-tooltip__loading-text"></span>
    <span class="lingq-tooltip__loading-bar" aria-hidden="true"></span>
  `;
  const text = element.querySelector('.lingq-tooltip__loading-text');
  if (text) {
    text.textContent = label;
  }
}

function clearLoadingHints() {
  loadingHintTimers.forEach((id) => window.clearTimeout(id));
  loadingHintTimers = [];
}

function startLoadingHints(requestId, kind) {
  clearLoadingHints();
  const slowKey = kind === 'phrase' ? 'bubble.translatingPhraseSlow' : 'bubble.translatingWordSlow';
  const stillKey = kind === 'phrase' ? 'bubble.translatingPhraseStill' : 'bubble.translatingWordStill';
  loadingHintTimers.push(window.setTimeout(() => {
    if (requestId !== activeRequest || !tooltip?.className.includes('loading')) {
      return;
    }
    const text = tooltip.querySelector('.lingq-tooltip__loading-text');
    if (text) {
      text.textContent = t(slowKey);
    }
  }, 2500));
  loadingHintTimers.push(window.setTimeout(() => {
    if (requestId !== activeRequest || !tooltip?.className.includes('loading')) {
      return;
    }
    const text = tooltip.querySelector('.lingq-tooltip__loading-text');
    if (text) {
      text.textContent = t(stillKey);
    }
  }, 7000));
}

function hideTooltip() {
  clearLoadingHints();
  if (tooltip) {
    tooltip.style.display = 'none';
  }
}

function pageLocationKey() {
  return `${location.pathname}${location.search}`;
}

function sleepMs(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

function schedulePageHighlight({ force = false, immediateBusy = false, settleRetries = null } = {}) {
  window.clearTimeout(schedulePageHighlight.timer);
  schedulePageHighlight.timer = window.setTimeout(() => {
    refreshPageHighlight({ force, immediateBusy, settleRetries }).catch(() => {});
  }, force ? 50 : 250);
}

function scheduleHighlightAfterNavigation() {
  if (highlightBusyEl && !highlightBusyEl.isConnected) {
    highlightBusyEl = null;
  }
  // Pruh hned; podbarvení několikrát po usazení DOM (Reddit SPA).
  beginHighlightBusy({ immediate: true });
  window.clearTimeout(scheduleHighlightAfterNavigation.timer);
  scheduleHighlightAfterNavigation.timer = window.setTimeout(() => {
    schedulePageHighlight({
      immediateBusy: true,
      settleRetries: [0, 600, 1400, 2800],
    });
  }, 120);
}

function watchPageNavigation() {
  if (watchPageNavigation.started) {
    return;
  }
  watchPageNavigation.started = true;
  watchPageNavigation.lastKey = pageLocationKey();

  const onMaybeNavigate = () => {
    const nextKey = pageLocationKey();
    if (nextKey === watchPageNavigation.lastKey) {
      return;
    }
    watchPageNavigation.lastKey = nextKey;
    scheduleHighlightAfterNavigation();
  };

  window.addEventListener('popstate', onMaybeNavigate);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      watchPageNavigation.lastKey = pageLocationKey();
      scheduleHighlightAfterNavigation();
    }
  });

  if (window.navigation && typeof window.navigation.addEventListener === 'function') {
    try {
      window.navigation.addEventListener('currententrychange', onMaybeNavigate);
    } catch {
      // Starší prohlížeče / omezený Navigation API.
    }
  }

  const wrapHistory = (methodName) => {
    const original = history[methodName];
    if (typeof original !== 'function') {
      return;
    }
    history[methodName] = function lingqWrappedHistory(...args) {
      const result = original.apply(this, args);
      queuePromise.resolve().then(onMaybeNavigate);
      return result;
    };
  };
  // Reddit často mění cestu i přes replaceState.
  wrapHistory('pushState');
  wrapHistory('replaceState');
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'REFRESH_HIGHLIGHTS') {
    refreshImportBannerFromStorage();
    schedulePageHighlight({ force: Boolean(message.force) });
    return;
  }
  if (message?.type !== 'HIGHLIGHT_PAGE_CHANGED') {
    return;
  }
  if (!siteEnabled || !highlightEnabled) {
    return;
  }
  const nextKey = pageLocationKey();
  const now = Date.now();
  if (watchPageNavigation.lastKey === nextKey
    && now - (watchPageNavigation.lastExternalAt || 0) < 500) {
    return;
  }
  watchPageNavigation.lastKey = nextKey;
  watchPageNavigation.lastExternalAt = now;
  scheduleHighlightAfterNavigation();
});

async function refreshPageHighlight({ force = false, immediateBusy = false, settleRetries = null } = {}) {
  if (!siteEnabled || !highlightEnabled) {
    hideHighlightBusy();
    clearPageHighlights();
    stopHighlightObserver();
    highlightMap = Object.create(null);
    return;
  }

  // Jedna běžící obnova; další požadavky se sloučí na jeden doběh.
  if (refreshPageHighlight.running) {
    refreshPageHighlight.queued = {
      force: Boolean(force) || Boolean(refreshPageHighlight.queued?.force),
      immediateBusy: Boolean(immediateBusy) || Boolean(refreshPageHighlight.queued?.immediateBusy),
      settleRetries: settleRetries || refreshPageHighlight.queued?.settleRetries || null,
    };
    return;
  }

  refreshPageHighlight.running = true;
  try {
    do {
      const queued = refreshPageHighlight.queued;
      refreshPageHighlight.queued = null;
      const runForce = Boolean(force) || Boolean(queued?.force);
      const runImmediateBusy = Boolean(immediateBusy) || Boolean(queued?.immediateBusy);
      const runRetries = Array.isArray(settleRetries)
        ? settleRetries
        : (Array.isArray(queued?.settleRetries) ? queued.settleRetries : [0]);
      force = false;
      immediateBusy = false;
      settleRetries = null;

      const runId = ++highlightRunId;
      const busyToken = beginHighlightBusy({ immediate: runImmediateBusy });
      try {
        // První načtení vždy z DB (ne ze staré cache po updatu doplňku).
        const requestForce = runForce || !schedulePageHighlight.loadedOnce;
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'GET_HIGHLIGHT_MAP', force: requestForce }, (result) => {
            if (chrome.runtime.lastError) {
              resolve(null);
              return;
            }
            resolve(result);
          });
        });

        if (!siteEnabled || !highlightEnabled) {
          clearPageHighlights();
          stopHighlightObserver();
          highlightMap = Object.create(null);
          break;
        }

        if (!response?.ok || response.enabled === false || response.ready === false) {
          clearPageHighlights();
          stopHighlightObserver();
          highlightMap = Object.create(null);
          if (response?.blockedByImport) {
            refreshImportBannerFromStorage();
          }
          break;
        }

        highlightMap = response.words && typeof response.words === 'object'
          ? response.words
          : Object.create(null);
        schedulePageHighlight.loadedOnce = true;

        clearPageHighlights();
        let previousDelay = 0;
        for (const delay of runRetries) {
          if (runId !== highlightRunId) {
            break;
          }
          const wait = Math.max(0, Number(delay) || 0) - previousDelay;
          previousDelay = Math.max(previousDelay, Number(delay) || 0);
          if (wait > 0) {
            await sleepMs(wait);
          }
          if (runId !== highlightRunId || !document.body) {
            break;
          }
          await applyHighlightsToRoot(document.body, runId);
        }
        if (runId === highlightRunId) {
          startHighlightObserver();
        }
      } finally {
        endHighlightBusy(busyToken);
      }
    } while (refreshPageHighlight.queued);
  } finally {
    refreshPageHighlight.running = false;
  }
}

function ensureHighlightBusyEl() {
  if (highlightBusyEl?.isConnected) {
    return highlightBusyEl;
  }
  const existing = document.getElementById('lingq-highlight-busy');
  if (existing) {
    highlightBusyEl = existing;
    return existing;
  }
  const el = document.createElement('div');
  el.id = 'lingq-highlight-busy';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;
  el.innerHTML = '<span class="lingq-highlight-busy__dot" aria-hidden="true"></span><span class="lingq-highlight-busy__text"></span><span class="lingq-highlight-busy__bar" aria-hidden="true"></span>';
  (document.documentElement || document.body).appendChild(el);
  highlightBusyEl = el;
  return el;
}

function beginHighlightBusy({ immediate = false } = {}) {
  const token = ++highlightBusyToken;
  window.clearTimeout(highlightBusyShowTimer);
  const show = () => {
    if (token !== highlightBusyToken) {
      return;
    }
    const el = ensureHighlightBusyEl();
    const text = el.querySelector('.lingq-highlight-busy__text');
    if (text) {
      text.textContent = t('highlight.preparing');
    }
    el.hidden = false;
    el.classList.add('lingq-highlight-busy--visible');
  };
  if (immediate) {
    show();
  } else {
    // Krátká prodleva — rychlá cache neblikne.
    highlightBusyShowTimer = window.setTimeout(show, 280);
  }
  return token;
}

function endHighlightBusy(token) {
  if (token != null && token !== highlightBusyToken) {
    return;
  }
  hideHighlightBusy();
}

function hideHighlightBusy() {
  window.clearTimeout(highlightBusyShowTimer);
  highlightBusyShowTimer = 0;
  highlightBusyToken += 1;
  if (!highlightBusyEl) {
    return;
  }
  highlightBusyEl.classList.remove('lingq-highlight-busy--visible');
  highlightBusyEl.hidden = true;
}

function clearPageHighlights() {
  highlightApplying = true;
  try {
    document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((span) => {
      const parent = span.parentNode;
      if (!parent) {
        return;
      }
      parent.replaceChild(document.createTextNode(span.textContent || ''), span);
      parent.normalize();
    });
  } finally {
    highlightApplying = false;
  }
}

/** Stejná normalizace jako background.highlightLookupKey — shoda s DB i stránkou. */
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
    return 300;
  }
  if (value === 6) {
    return 200;
  }
  if (value >= 1 && value <= 4) {
    return value;
  }
  return 0;
}

function resolveHighlightEntry(rawWord) {
  let best = null;
  for (const key of highlightKeyVariants(rawWord)) {
    if (!Object.prototype.hasOwnProperty.call(highlightMap, key)) {
      continue;
    }
    const status = Number(highlightMap[key]);
    if (!Number.isInteger(status)) {
      continue;
    }
    if (best == null || highlightMergePriority(status) > highlightMergePriority(best.status)) {
      best = { key, status, inDb: true };
    }
  }
  return best || { key: highlightLookupKey(rawWord), status: 0, inDb: false };
}

function highlightClassForStatus(status) {
  const level = Number(status);
  // −1 = Ignored, 5 = K, 6 = v DB bez překladu → bez barvy
  if (level === -1 || level === 5 || level === 6) {
    return null;
  }
  if (Number.isInteger(level) && level >= 1 && level <= 4) {
    return `${HIGHLIGHT_CLASS} ${HIGHLIGHT_CLASS}--${level}`;
  }
  return `${HIGHLIGHT_CLASS} ${HIGHLIGHT_CLASS}--new`;
}

function updateHighlightForWord(word, status) {
  const keys = highlightKeyVariants(word);
  if (keys.length === 0) {
    return;
  }
  const level = Number(status);
  if (level === -1 || (Number.isInteger(level) && level >= 1 && level <= 5)) {
    keys.forEach((key) => {
      highlightMap[key] = level;
    });
  } else {
    keys.forEach((key) => {
      delete highlightMap[key];
    });
  }

  const entry = resolveHighlightEntry(word);
  const className = highlightClassForStatus(entry.inDb ? entry.status : 0);
  const keySet = new Set(keys);

  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((span) => {
    const spanKeys = highlightKeyVariants(span.textContent);
    if (!spanKeys.some((key) => keySet.has(key))) {
      return;
    }
    if (!className) {
      const parent = span.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(span.textContent || ''), span);
        parent.normalize();
      }
      return;
    }
    span.className = className;
    span.dataset.lingqHl = entry.inDb ? String(entry.status) : 'new';
  });
}

const overlayLinkCache = new WeakMap();

function isLinkElement(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }
  const tag = String(el.tagName || '').toUpperCase();
  if (tag === 'A' || tag === 'AREA') {
    return true;
  }
  if (el.getAttribute?.('role') === 'link') {
    return true;
  }
  // Obyčejný i custom prvek s href (Reddit / routery).
  if (el.hasAttribute?.('href')) {
    return true;
  }
  const name = String(el.localName || '').toLowerCase();
  if (
    name.endsWith('-link')
    || name.endsWith('-anchor')
    || name.includes('permalink')
    || name.includes('faceplate-tracker')
  ) {
    return true;
  }
  return false;
}

/** Parent ve light i shadow DOM včetně slotted obsahu. */
function composedParent(el) {
  if (!el) {
    return null;
  }
  if (el.assignedSlot) {
    return el.assignedSlot;
  }
  if (el.parentElement) {
    return el.parentElement;
  }
  const root = typeof el.getRootNode === 'function' ? el.getRootNode() : null;
  if (root && root !== document && root.host) {
    return root.host;
  }
  return null;
}

function elementHasCoveringLink(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE || typeof el.querySelector !== 'function') {
    return false;
  }
  if (overlayLinkCache.has(el)) {
    return overlayLinkCache.get(el);
  }
  let result = false;
  try {
    // Jen přímé děti — jinak by body/main se všemi odkazy zablokovaly celé podbarvení.
    const links = el.querySelectorAll(':scope > a[href], :scope > [role="link"], :scope > [href]');
    for (const link of links) {
      let style;
      try {
        style = window.getComputedStyle(link);
      } catch {
        continue;
      }
      if (!style) {
        continue;
      }
      if (style.position === 'absolute' || style.position === 'fixed') {
        const width = Number.parseFloat(style.width);
        const height = Number.parseFloat(style.height);
        const insetFull = style.inset === '0px'
          || (style.top === '0px' && style.right === '0px' && style.bottom === '0px' && style.left === '0px');
        if (insetFull || (width >= 40 && height >= 40) || style.width === '100%' || style.height === '100%') {
          result = true;
          break;
        }
      }
      const cls = `${link.className || ''} ${link.getAttribute?.('slot') || ''}`;
      if (/\binset-0\b|\babsolute\b|full-post-link|post-link|overlay/i.test(cls)) {
        result = true;
        break;
      }
    }
  } catch {
    result = false;
  }
  overlayLinkCache.set(el, result);
  return result;
}

function findSiblingPostLink(container, textEl) {
  if (!container?.querySelectorAll || !textEl) {
    return null;
  }
  try {
    for (const link of container.querySelectorAll('a[href], [href]')) {
      const href = String(link.getAttribute?.('href') || link.href || '');
      if (!/\/comments\//.test(href) && !/\/r\/[^/]+\/s\//.test(href)) {
        continue;
      }
      if (link.contains(textEl)) {
        continue;
      }
      return link;
    }
  } catch {
    return null;
  }
  return null;
}

function isCompactLinkedCardChrome(node) {
  const textEl = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!textEl) {
    return false;
  }
  let el = textEl;
  for (let depth = 0; depth < 10 && el; depth += 1) {
    const postLink = findSiblingPostLink(el, textEl);
    if (postLink) {
      let rect;
      try {
        rect = el.getBoundingClientRect();
      } catch {
        rect = null;
      }
      // Related post karta je nízká; hlavní článek je vysoký — ten nepřeskakovat.
      if (rect && rect.height > 0 && rect.height <= 260 && rect.width > 0 && rect.width <= 560) {
        return true;
      }
    }
    el = composedParent(el);
  }
  return false;
}

function isInsideLink(node) {
  let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  let depth = 0;
  while (el && depth < 40) {
    if (isLinkElement(el)) {
      return true;
    }
    el = composedParent(el);
    depth += 1;
  }

  // Karty s překryvným odkazem (absolutní <a> přes celou kartu).
  el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  depth = 0;
  while (el && depth < 12) {
    if (elementHasCoveringLink(el)) {
      return true;
    }
    el = composedParent(el);
    depth += 1;
  }

  // Reddit related posts: „397 pozitivních hlasů“ je mimo <a>, ale ve stejné kartě jako permalink.
  if (isCompactLinkedCardChrome(node)) {
    return true;
  }
  return false;
}

function unwrapHighlightSpan(span) {
  const parent = span.parentNode;
  if (!parent) {
    return;
  }
  parent.replaceChild(document.createTextNode(span.textContent || ''), span);
  parent.normalize();
}

function removeHighlightsInsideLinks(root = document) {
  const scope = root && root.querySelectorAll ? root : document;
  const spans = scope.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
  if (spans.length === 0) {
    return;
  }
  const wasApplying = highlightApplying;
  highlightApplying = true;
  try {
    spans.forEach((span) => {
      if (isInsideLink(span)) {
        unwrapHighlightSpan(span);
      }
    });
  } finally {
    highlightApplying = wasApplying;
  }
}

function isHighlightSkipped(node) {
  let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (isInsideLink(node)) {
    return true;
  }
  while (el) {
    const tag = String(el.tagName || '').toUpperCase();
    if (el.id === TOOLTIP_ID || el.id === 'lingq-highlight-busy' || el.classList?.contains(HIGHLIGHT_CLASS)) {
      return true;
    }
    if (HIGHLIGHT_SKIP_TAGS.has(tag)) {
      return true;
    }
    if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true') {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

async function applyHighlightsToRoot(root, runId) {
  if (!root) {
    return;
  }

  const textNodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !/\S/.test(node.nodeValue)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (isHighlightSkipped(node)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let current = walker.nextNode();
  while (current) {
    textNodes.push(current);
    current = walker.nextNode();
  }

  const chunkSize = 40;
  for (let i = 0; i < textNodes.length; i += chunkSize) {
    if (runId !== highlightRunId) {
      return;
    }
    highlightApplying = true;
    try {
      textNodes.slice(i, i + chunkSize).forEach((node) => {
        if (node.isConnected) {
          wrapHighlightedWords(node);
        }
      });
    } finally {
      highlightApplying = false;
    }
    await new Promise((resolve) => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => resolve(), { timeout: 80 });
      } else {
        window.setTimeout(resolve, 0);
      }
    });
  }
  if (runId === highlightRunId) {
    removeHighlightsInsideLinks(root);
  }
}

function wrapHighlightedWords(textNode) {
  const text = textNode.nodeValue || '';
  const pattern = /[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'’\-]*/gu;
  let match;
  let lastIndex = 0;
  let changed = false;
  const fragment = document.createDocumentFragment();

  while ((match = pattern.exec(text))) {
    const raw = match[0];
    if (!hasLetter(raw)) {
      continue;
    }
    const entry = resolveHighlightEntry(raw);
    if (!entry.key && !entry.inDb) {
      continue;
    }
    // Ignored (−1) / K (5) / v DB bez překladu (6) bez barvy; 1–4 žlutá; mimo DB = neznámé (modrá).
    if (entry.inDb && (entry.status === -1 || entry.status === 5 || entry.status === 6)) {
      continue;
    }
    const className = highlightClassForStatus(entry.inDb ? entry.status : 0);
    if (!className) {
      continue;
    }
    if (match.index > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const span = document.createElement('span');
    span.className = className;
    span.dataset.lingqHl = entry.inDb ? String(entry.status) : 'new';
    span.textContent = raw;
    fragment.appendChild(span);
    lastIndex = match.index + raw.length;
    changed = true;
  }

  if (!changed) {
    return;
  }
  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
  // Mezitím mohl vzniknout odkaz kolem textu — nepodbarvovat.
  if (isInsideLink(textNode.parentElement || textNode)) {
    return;
  }
  textNode.parentNode?.replaceChild(fragment, textNode);
}

function startHighlightObserver() {
  if (highlightObserver || !document.body) {
    return;
  }
  highlightObserver = new MutationObserver((mutations) => {
    if (highlightApplying || !siteEnabled || !highlightEnabled || refreshPageHighlight.running) {
      return;
    }
    const roots = [];
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (
            node.classList?.contains(HIGHLIGHT_CLASS)
            || node.id === TOOLTIP_ID
            || node.id === 'lingq-highlight-busy'
          ) {
            return;
          }
          roots.push(node);
        } else if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
          roots.push(node.parentElement);
        }
      });
    }
    if (roots.length === 0) {
      return;
    }
    window.clearTimeout(highlightMutationTimer);
    highlightMutationTimer = window.setTimeout(() => {
      if (highlightApplying || refreshPageHighlight.running) {
        return;
      }
      const runId = highlightRunId;
      roots.forEach((root) => {
        if (!root.isConnected) {
          return;
        }
        // Nový odkaz kolem už podbarveného textu → barvu zase sundat.
        removeHighlightsInsideLinks(root);
        if (!isHighlightSkipped(root)) {
          applyHighlightsToRoot(root, runId).catch(() => {});
        }
      });
    }, 400);
  });
  highlightObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function stopHighlightObserver() {
  if (highlightObserver) {
    highlightObserver.disconnect();
    highlightObserver = null;
  }
  window.clearTimeout(highlightMutationTimer);
}

watchPageNavigation();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => schedulePageHighlight(), { once: true });
} else {
  schedulePageHighlight();
}
