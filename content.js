const TOOLTIP_ID = 'lingq-click-translator-tooltip';
const WORD_PATTERN = /[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'’\-]*/u;
const STATUS_LEVELS = [['1', 1], ['2', 2], ['3', 3], ['4', 4], ['K', 5]];
const USER_PHRASE_WORD_LIMIT = 10;
let enabled = true;
let clickCount = 1;
let sourceLanguage = 'en';
let targetLanguage = 'cs';
let uiTheme = 'light';
let activeRequest = 0;
let phraseSelectionActive = false;
let tooltip;

function normalizeUiTheme(value) {
  return value === 'dark' ? 'dark' : 'light';
}

function applyTooltipTheme() {
  if (tooltip) {
    tooltip.dataset.theme = uiTheme;
  }
}

chrome.storage.sync.get({
  enabled: true,
  clickCount: 1,
  language: 'en',
  targetLanguage: 'cs',
  theme: 'light',
}, (settings) => {
  enabled = settings.enabled;
  clickCount = Number(settings.clickCount) === 2 ? 2 : 1;
  sourceLanguage = settings.language || 'en';
  targetLanguage = settings.targetLanguage || 'cs';
  uiTheme = normalizeUiTheme(settings.theme);
  applyTooltipTheme();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') {
    return;
  }
  if (changes.enabled) {
    enabled = changes.enabled.newValue;
  }
  if (changes.clickCount) {
    clickCount = Number(changes.clickCount.newValue) === 2 ? 2 : 1;
  }
  if (changes.language) {
    sourceLanguage = changes.language.newValue || 'en';
  }
  if (changes.targetLanguage) {
    targetLanguage = changes.targetLanguage.newValue || 'cs';
  }
  if (changes.theme) {
    uiTheme = normalizeUiTheme(changes.theme.newValue);
    applyTooltipTheme();
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

function handlePhraseSelection(event) {
  if (!enabled || event.button !== 0) {
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

  const isAdmin = typeof isAdminBuild === 'function' && isAdminBuild();
  if (!isAdmin && selected.wordCount > USER_PHRASE_WORD_LIMIT) {
    showPhraseTooltip(selected.text, selected.rect, `Výběr má ${selected.wordCount} slov (limit ${USER_PHRASE_WORD_LIMIT}). Otevřete překladač.`, 'external');
    return;
  }

  const requestId = ++activeRequest;
  const clickedAt = Date.now();
  showPhraseTooltip(selected.text, selected.rect, 'Překládám větu…', 'loading');
  chrome.runtime.sendMessage({ type: 'TRANSLATE_PHRASE', text: selected.text, clickedAt }, (response) => {
    if (requestId !== activeRequest) {
      return;
    }
    if (chrome.runtime.lastError || !response?.ok) {
      showPhraseTooltip(selected.text, selected.rect, response?.error || 'Překlad věty se nezdařil.', 'error');
      return;
    }
    showPhraseTooltip(selected.text, selected.rect, response.translation, 'ready');
  });
}

function handleClick(event) {
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

function lookupFromPoint(clientX, clientY, target, event) {
  const clickedAt = Date.now();
  const selection = getWordSelection(clientX, clientY, target);
  if (!selection) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const requestId = ++activeRequest;
  showTooltip(selection.word, selection.rect, 'Překládám slovo…', 'loading', 0, null, []);

  chrome.runtime.sendMessage({ type: 'LOOKUP_WORD', word: selection.word, clickedAt }, (response) => {
    if (requestId !== activeRequest) {
      return;
    }
    if (chrome.runtime.lastError || !response?.ok) {
      showTooltip(selection.word, selection.rect, response?.error || 'Spojení s LingQ se nezdařilo.', 'error', 0, null, []);
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
      <button class="lingq-tooltip__close" type="button" aria-label="Zavřít">×</button>
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
    openButton.textContent = 'Otevřít překladač';
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
    originalButton.textContent = 'Kopírovat originál';
    originalButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      copyTextToClipboard(original, originalButton, 'Kopírovat originál');
    });
    container.appendChild(originalButton);
  }

  if (showTranslation) {
    const translationButton = document.createElement('button');
    translationButton.type = 'button';
    translationButton.className = 'lingq-tooltip__copy';
    translationButton.textContent = 'Kopírovat překlad';
    translationButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const liveTranslation = tooltip?.dataset.translation || translation;
      copyTextToClipboard(liveTranslation, translationButton, 'Kopírovat překlad');
    });
    container.appendChild(translationButton);
  }
}

function copyTextToClipboard(text, button, idleLabel) {
  const value = String(text || '');
  if (!value) {
    button.textContent = 'Není co kopírovat';
    window.setTimeout(() => {
      button.textContent = idleLabel;
    }, 1400);
    return;
  }

  const done = () => {
    button.textContent = 'Zkopírováno';
    window.setTimeout(() => {
      button.textContent = idleLabel;
    }, 1400);
  };
  const failed = () => {
    button.textContent = 'Kopírování se nezdařilo';
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
  tooltip.innerHTML = '<div class="lingq-tooltip__top"><span class="lingq-tooltip__word"></span><button class="lingq-tooltip__close" type="button" aria-label="Zavřít">×</button></div><span class="lingq-tooltip__translation"></span><span class="lingq-tooltip__views" hidden></span><div class="lingq-tooltip__levels" role="group" aria-label="Úroveň znalosti"></div><button class="lingq-tooltip__alternatives" type="button"></button><div class="lingq-tooltip__alternative-list" hidden></div><div class="lingq-tooltip__actions" hidden></div><span class="lingq-tooltip__message" role="status"></span>';
  tooltip.querySelector('.lingq-tooltip__word').textContent = word;
  const translationElement = tooltip.querySelector('.lingq-tooltip__translation');
  translationElement.textContent = translation;
  const viewsElement = tooltip.querySelector('.lingq-tooltip__views');
  const seenCount = Number(viewCount);
  if (Number.isInteger(seenCount) && seenCount > 1 && kind !== 'loading' && kind !== 'error') {
    viewsElement.hidden = false;
    viewsElement.textContent = `Viděno ${seenCount}×`;
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
      button.title = `Nastavit úroveň ${label}`;
      button.addEventListener('click', () => changeStatus(value));
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
    alternativeButton.addEventListener('click', () => {
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
    empty.textContent = 'Další překlady se nenašly.';
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
    addButton.title = 'Přidat do překladu';
    addButton.setAttribute('aria-label', 'Přidat do překladu');
    addButton.addEventListener('click', (event) => {
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
    return 'Načítám překlady…';
  }
  if (state === 'hide') {
    return 'Skrýt překlady';
  }
  return `Další překlady (${api})`;
}

function friendlyAlternativesError(message) {
  const text = String(message || '');
  if (/message channel closed/i.test(text) || /asynchronous response/i.test(text)) {
    return 'ChatGPT neodpovědělo včas. Zkuste to znovu nebo zvolte rychlejší model.';
  }
  return text || 'Další překlady se nepodařilo načíst.';
}

function loadAlternativeTranslations(word, translation, alternativeButton, alternativeList, translationElement, rect) {
  const source = tooltip?.dataset.alternativesSource === 'chatgpt' ? 'chatgpt' : 'lingq';
  alternativeButton.disabled = true;
  alternativeButton.textContent = alternativesButtonLabel(source, 'loading');
  alternativeList.hidden = false;
  alternativeList.innerHTML = '<div class="lingq-tooltip__alternative lingq-tooltip__alternative--empty">Načítám další překlady…</div>';
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
        response?.error || chrome.runtime.lastError?.message || 'Další překlady se nepodařilo načíst.',
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
  showTooltipMessage('Ukládám překlad…');
  chrome.runtime.sendMessage({ type: 'UPDATE_TRANSLATION', cardId, word, translation: merged }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      translationElement.textContent = current;
      tooltip.dataset.translation = current;
      pendingTranslation = '';
      if (addButton) {
        addButton.disabled = false;
      }
      showTooltipMessage(response?.error || 'Překlad se nepodařilo uložit.');
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
    showTooltipMessage('Překlad uložen.');
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
  element.title = 'Kliknutím upravíte překlad';
  element.spellcheck = true;

  element.addEventListener('click', () => {
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
  showTooltipMessage('Ukládám překlad…');
  chrome.runtime.sendMessage({ type: 'UPDATE_TRANSLATION', cardId, word, translation: next }, (response) => {
    if (requestId !== translationSaveRequest) {
      return;
    }
    if (pendingTranslation === next) {
      pendingTranslation = '';
    }
    if (chrome.runtime.lastError || !response?.ok) {
      showTooltipMessage(response?.error || 'Překlad se nepodařilo uložit.');
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
    showTooltipMessage('Překlad uložen.');
  });
}

function changeStatus(status) {
  const cardId = tooltip?.dataset.cardId || '';
  const word = tooltip?.dataset.word || '';
  const translation = tooltip?.dataset.translation || '';

  const buttons = [...tooltip.querySelectorAll('.lingq-level')];
  buttons.forEach((button) => { button.disabled = true; });
  showTooltipMessage('Ukládám úroveň…');

  chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', cardId, status, word, translation }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      buttons.forEach((button) => { button.disabled = false; });
      showTooltipMessage(response?.error || 'Úroveň se nepodařilo uložit.');
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
    showTooltipMessage('Úroveň uložena.');
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
