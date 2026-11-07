const TOOLTIP_ID = 'lingq-click-translator-tooltip';
const WORD_PATTERN = /[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'’\-]*/u;
const STATUS_LEVELS = [['1', 1], ['2', 2], ['3', 3], ['4', 4], ['K', 5]];
const USER_PHRASE_WORD_LIMIT = 10;
const HIGHLIGHT_CLASS = 'lingq-hl';
const HIGHLIGHT_SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
  'CODE', 'PRE', 'SVG', 'MATH', 'IFRAME', 'OBJECT', 'VIDEO', 'AUDIO', 'CANVAS',
  'HEAD', 'TITLE', 'META', 'LINK', 'BR', 'HR', 'IMG', 'PICTURE', 'SOURCE',
  'A',
]);
let enabled = true;
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

chrome.storage.sync.get({
  enabled: true,
  highlightEnabled: true,
  clickCount: 2,
  language: 'en',
  targetLanguage: 'cs',
  theme: 'light',
  phraseTranslationSource: 'lingq',
  lingqEnabled: true,
}, (settings) => {
  enabled = settings.enabled !== false;
  highlightEnabled = settings.highlightEnabled !== false;
  clickCount = Number(settings.clickCount) === 2 ? 2 : 1;
  sourceLanguage = settings.language || 'en';
  targetLanguage = settings.targetLanguage || 'cs';
  uiTheme = normalizeUiTheme(settings.theme);
  phraseTranslationSource = settings.lingqEnabled === false
    ? 'chatgpt'
    : normalizePhraseSource(settings.phraseTranslationSource);
  applyTooltipTheme();
  schedulePageHighlight();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') {
    return;
  }
  if (changes.enabled) {
    enabled = changes.enabled.newValue !== false;
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
  if (changes.supabaseEnabled || changes.supabaseUrl || changes.supabaseKey) {
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
  if (!event.isTrusted || !enabled || event.button !== 0) {
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
  chrome.runtime.sendMessage({ type: 'TRANSLATE_PHRASE', text: selected.text, clickedAt }, (response) => {
    if (requestId !== activeRequest) {
      return;
    }
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

  if (!enabled || event.button !== 0) {
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

  chrome.runtime.sendMessage({ type: 'LOOKUP_WORD', word: selection.word, clickedAt }, (response) => {
    if (requestId !== activeRequest) {
      return;
    }
    if (chrome.runtime.lastError || !response?.ok) {
      showTooltip(selection.word, selection.rect, response?.error || t('bubble.lingqFailed'), 'error', 0, null, []);
      return;
    }
    const kind = response.unknown ? 'unknown' : 'known';
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
    if (Number.isFinite(Number(response.status)) && Number(response.status) > 0) {
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
  tooltip.querySelector('.lingq-tooltip__phrase-translation').textContent = translation;
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
  if (!word) {
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
  translationElement.textContent = translation;
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
    STATUS_LEVELS.forEach(([label, value]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `lingq-level lingq-level--${value === Number(status) ? 'active' : 'empty'}`;
      if (value === 5) {
        button.classList.add('lingq-level--known');
      }
      button.textContent = label;
      button.title = t('bubble.setLevel', { level: label });
      button.addEventListener('click', (event) => {
        if (!event.isTrusted) {
          return;
        }
        changeStatus(value);
      });
      levels.appendChild(button);
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
      const value = STATUS_LEVELS[index][1];
      button.className = `lingq-level lingq-level--${value === Number(response.status) ? 'active' : 'empty'}`;
      if (value === 5) {
        button.classList.add('lingq-level--known');
      }
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

function hideTooltip() {
  if (tooltip) {
    tooltip.style.display = 'none';
  }
}

function schedulePageHighlight({ force = false } = {}) {
  window.clearTimeout(schedulePageHighlight.timer);
  schedulePageHighlight.timer = window.setTimeout(() => {
    refreshPageHighlight({ force }).catch(() => {});
  }, force ? 50 : 250);
}

async function refreshPageHighlight({ force = false } = {}) {
  if (!enabled || !highlightEnabled) {
    clearPageHighlights();
    stopHighlightObserver();
    highlightMap = Object.create(null);
    return;
  }

  const runId = ++highlightRunId;
  // První načtení vždy z DB (ne ze staré cache po updatu doplňku).
  const requestForce = Boolean(force) || !schedulePageHighlight.loadedOnce;
  const response = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_HIGHLIGHT_MAP', force: requestForce }, (result) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(result);
    });
  });

  if (runId !== highlightRunId) {
    return;
  }

  if (!response?.ok || response.enabled === false || response.ready === false) {
    clearPageHighlights();
    stopHighlightObserver();
    highlightMap = Object.create(null);
    return;
  }

  highlightMap = response.words && typeof response.words === 'object'
    ? response.words
    : Object.create(null);
  schedulePageHighlight.loadedOnce = true;

  clearPageHighlights();
  await applyHighlightsToRoot(document.body, runId);
  if (runId === highlightRunId) {
    startHighlightObserver();
  }
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
  // 5 = K, 6 = v DB bez překladu → bez barvy
  if (level === 5 || level === 6) {
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
  if (Number.isInteger(level) && level >= 1 && level <= 5) {
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

function isHighlightSkipped(node) {
  let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (el) {
    const tag = String(el.tagName || '').toUpperCase();
    if (el.id === TOOLTIP_ID || el.classList?.contains(HIGHLIGHT_CLASS)) {
      return true;
    }
    if (HIGHLIGHT_SKIP_TAGS.has(tag)) {
      return true;
    }
    // Odkazy — nikdy nepodbarvovat.
    if (tag === 'A' || tag === 'AREA' || el.getAttribute?.('role') === 'link') {
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
    const entry = resolveHighlightEntry(raw);
    if (!entry.key && !entry.inDb) {
      continue;
    }
    // K (5) / v DB bez překladu (6) bez barvy; 1–4 žlutá; mimo DB = neznámé (modrá).
    if (entry.inDb && (entry.status === 5 || entry.status === 6)) {
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
  textNode.parentNode?.replaceChild(fragment, textNode);
}

function startHighlightObserver() {
  if (highlightObserver || !document.body) {
    return;
  }
  highlightObserver = new MutationObserver((mutations) => {
    if (highlightApplying || !enabled || !highlightEnabled) {
      return;
    }
    const roots = [];
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.classList?.contains(HIGHLIGHT_CLASS) || node.id === TOOLTIP_ID) {
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
      const runId = highlightRunId;
      roots.forEach((root) => {
        if (root.isConnected && !isHighlightSkipped(root)) {
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => schedulePageHighlight(), { once: true });
} else {
  schedulePageHighlight();
}
