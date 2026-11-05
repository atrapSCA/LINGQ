const DEFAULTS = {
  apiKey: 'd59c2650c569e8f6aba883b9d4fb48826d1b1d25',
  language: 'en',
  targetLanguage: 'cs',
  enabled: true,
  clickCount: 1,
  supabaseUrl: 'https://vsvgxetuilgwhrqnyipd.supabase.co',
  supabaseKey: 'sb_publishable_xt7bWa2O1LYbohcB4x77ig_E8AXesvc',
};

const POPUP_SIZE_DEFAULTS = {
  popupWidth: 645,
  popupHeight: 620,
};

const POPUP_SIZE_LIMITS = {
  minWidth: 360,
  maxWidth: 800,
  minHeight: 420,
  maxHeight: 600,
};

const form = document.getElementById('settings-form');
const apiKeyInput = document.getElementById('api-key');
const languageInput = document.getElementById('language');
const targetLanguageInput = document.getElementById('target-language');
const supabaseUrlInput = document.getElementById('supabase-url');
const supabaseKeyInput = document.getElementById('supabase-key');
const enabledInput = document.getElementById('enabled');
const clickCountInput = document.getElementById('click-count');
const clickHelp = document.getElementById('click-help');
const toggleKeyButton = document.getElementById('toggle-key');
const formMessage = document.getElementById('form-message');
const statusTitle = document.getElementById('status-title');
const statusDescription = document.getElementById('status-description');
const statusDot = document.getElementById('status-dot');
const tabButtons = [...document.querySelectorAll('.tab')];
const panelSettings = document.getElementById('panel-settings');
const panelWords = document.getElementById('panel-words');
const wordSearchInput = document.getElementById('word-search');
const wordSortInput = document.getElementById('word-sort');
const wordsMeta = document.getElementById('words-meta');
const wordsList = document.getElementById('words-list');
const resizeHandle = document.getElementById('resize-handle');

let allWords = [];
let wordsLoaded = false;
let wordsLoading = false;
let currentPopupWidth = POPUP_SIZE_DEFAULTS.popupWidth;
let currentPopupHeight = POPUP_SIZE_DEFAULTS.popupHeight;

restorePopupSize();
setupPopupResize();

chrome.storage.sync.get(DEFAULTS, (settings) => {
  apiKeyInput.value = settings.apiKey;
  languageInput.value = settings.language;
  targetLanguageInput.value = settings.targetLanguage;
  supabaseUrlInput.value = settings.supabaseUrl || DEFAULTS.supabaseUrl;
  supabaseKeyInput.value = settings.supabaseKey || DEFAULTS.supabaseKey;
  enabledInput.checked = settings.enabled;
  clickCountInput.value = Number(settings.clickCount) === 2 ? '2' : '1';
  renderStatus(settings.enabled);
  renderClickHelp(clickCountInput.value);
  activateTab('words');
});

tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    activateTab(button.dataset.tab);
  });
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  chrome.storage.sync.set({
    apiKey: apiKeyInput.value.trim(),
    language: languageInput.value,
    targetLanguage: targetLanguageInput.value,
    supabaseUrl: supabaseUrlInput.value.trim().replace(/\/$/, ''),
    supabaseKey: supabaseKeyInput.value.trim(),
  }, () => {
    formMessage.textContent = 'Nastavení bylo uloženo.';
    wordsLoaded = false;
    window.setTimeout(() => { formMessage.textContent = ''; }, 2200);
  });
});

enabledInput.addEventListener('change', () => {
  const enabled = enabledInput.checked;
  chrome.storage.sync.set({ enabled });
  renderStatus(enabled);
});

clickCountInput.addEventListener('change', () => {
  const clickCount = clickCountInput.value === '2' ? 2 : 1;
  chrome.storage.sync.set({ clickCount });
  renderClickHelp(clickCount);
});

toggleKeyButton.addEventListener('click', () => {
  const showing = apiKeyInput.type === 'text';
  apiKeyInput.type = showing ? 'password' : 'text';
  toggleKeyButton.textContent = showing ? 'Zobrazit' : 'Skrýt';
});

wordSearchInput.addEventListener('input', () => {
  renderWords();
});

wordSortInput.addEventListener('change', () => {
  renderWords();
});

function activateTab(tabName) {
  const showWords = tabName === 'words';
  tabButtons.forEach((button) => {
    const active = button.dataset.tab === tabName;
    button.classList.toggle('tab--active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  panelSettings.hidden = showWords;
  panelWords.hidden = !showWords;
  if (showWords) {
    loadWords(false);
  }
}

function renderClickHelp(clickCount) {
  clickHelp.textContent = Number(clickCount) === 2
    ? 'Bublina se otevře po dvojitém kliknutí na slovo.'
    : 'Bublina se otevře po jednom kliknutí. U odkazů je potřeba dvojité kliknutí, aby se stránka neotevřela.';
}

function renderStatus(enabled) {
  statusTitle.textContent = enabled ? 'Doplněk je aktivní' : 'Doplněk je pozastavený';
  statusDescription.textContent = enabled ? 'Funguje na všech webových stránkách' : 'Kliknutí na slova jsou dočasně vypnutá';
  statusDot.style.background = enabled ? '#4dbea0' : '#a9b7b5';
  statusDot.style.boxShadow = enabled ? '0 0 0 4px #e2f4ef' : '0 0 0 4px #edf1f0';
}

function loadWords(force) {
  if (wordsLoading) {
    return;
  }
  if (wordsLoaded && !force) {
    renderWords();
    return;
  }

  wordsLoading = true;
  wordsMeta.textContent = 'Načítám slovíčka…';
  wordsList.innerHTML = '';

  chrome.runtime.sendMessage({ type: 'LIST_SUPABASE_WORDS' }, (response) => {
    wordsLoading = false;
    if (chrome.runtime.lastError || !response?.ok) {
      wordsLoaded = false;
      allWords = [];
      wordsMeta.textContent = '';
      wordsList.innerHTML = `<div class="words-empty">${response?.error || chrome.runtime.lastError?.message || 'Slovník se nepodařilo načíst.'}</div>`;
      return;
    }

    wordsLoaded = true;
    allWords = Array.isArray(response.words) ? response.words : [];
    renderWords();
  });
}

function renderWords() {
  const query = wordSearchInput.value.trim().toLowerCase();
  const sort = wordSortInput.value;
  let items = allWords.slice();

  if (query) {
    items = items.filter((item) => {
      const word = String(item.word || '').toLowerCase();
      const translation = String(item.translation || '').toLowerCase();
      return word.includes(query) || translation.includes(query);
    });
  }

  items.sort((left, right) => {
    const leftWord = String(left.word || '');
    const rightWord = String(right.word || '');
    const leftViews = Number(left.view_count) || 0;
    const rightViews = Number(right.view_count) || 0;
    if (sort === 'alpha-desc') {
      return rightWord.localeCompare(leftWord, 'cs', { sensitivity: 'base' });
    }
    if (sort === 'views-desc') {
      return rightViews - leftViews || leftWord.localeCompare(rightWord, 'cs', { sensitivity: 'base' });
    }
    if (sort === 'views-asc') {
      return leftViews - rightViews || leftWord.localeCompare(rightWord, 'cs', { sensitivity: 'base' });
    }
    return leftWord.localeCompare(rightWord, 'cs', { sensitivity: 'base' });
  });

  if (allWords.length === 0) {
    wordsMeta.textContent = 'V databázi zatím nejsou žádná slovíčka.';
    wordsList.innerHTML = '<div class="words-empty">Klikni na slovo na stránce — uloží se sem.</div>';
    return;
  }

  wordsMeta.textContent = query
    ? `Zobrazeno ${items.length} z ${allWords.length}`
    : `${allWords.length} slovíček`;

  if (items.length === 0) {
    wordsList.innerHTML = '<div class="words-empty">Nic neodpovídá hledání.</div>';
    return;
  }

  wordsList.innerHTML = '';
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'word-row';
    row.setAttribute('role', 'listitem');

    const main = document.createElement('div');
    main.className = 'word-row__main';

    const term = document.createElement('span');
    term.className = 'word-row__term';
    term.textContent = item.word || '';

    const translation = document.createElement('span');
    translation.className = 'word-row__translation';
    const translationText = String(item.translation || '').trim();
    translation.textContent = translationText || 'Bez překladu';
    if (!translationText) {
      translation.classList.add('word-row__translation--empty');
    }

    const dates = document.createElement('span');
    dates.className = 'word-row__dates';
    const created = formatDateTime(item.created_at);
    const updated = formatDateTime(item.updated_at);
    dates.textContent = created
      ? (updated && updated !== created ? `Vloženo ${created} · Upraveno ${updated}` : `Vloženo ${created}`)
      : '';

    main.append(term, translation);
    if (dates.textContent) {
      main.append(dates);
    }

    const views = document.createElement('span');
    views.className = 'word-row__views';
    const viewCount = Number(item.view_count) || 0;
    views.textContent = `${viewCount}×`;

    const status = document.createElement('span');
    const statusLabel = formatStatus(item.status);
    status.className = `word-row__status${statusLabel === 'K' ? ' word-row__status--known' : ''}`;
    status.textContent = statusLabel;
    status.title = `Úroveň znalosti ${statusLabel}`;

    row.append(main, views, status);
    wordsList.appendChild(row);
  });
}

function formatStatus(status) {
  const value = Number(status);
  if (value === 5) {
    return 'K';
  }
  if (Number.isInteger(value) && value >= 1 && value <= 4) {
    return String(value);
  }
  return '1';
}

function formatDateTime(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function restorePopupSize() {
  chrome.storage.local.get(POPUP_SIZE_DEFAULTS, (stored) => {
    applyPopupSize(stored.popupWidth, stored.popupHeight, false);
  });
}

function setupPopupResize() {
  if (!resizeHandle) {
    return;
  }

  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;

  const onPointerMove = (event) => {
    const nextWidth = startWidth + (event.clientX - startX);
    const nextHeight = startHeight + (event.clientY - startY);
    applyPopupSize(nextWidth, nextHeight, false);
  };

  const onPointerUp = (event) => {
    resizeHandle.releasePointerCapture?.(event.pointerId);
    document.body.classList.remove('is-resizing');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    applyPopupSize(currentPopupWidth, currentPopupHeight, true);
  };

  resizeHandle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    startX = event.clientX;
    startY = event.clientY;
    startWidth = currentPopupWidth;
    startHeight = currentPopupHeight;
    document.body.classList.add('is-resizing');
    resizeHandle.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  });
}

function applyPopupSize(width, height, persist) {
  currentPopupWidth = clampNumber(width, POPUP_SIZE_LIMITS.minWidth, POPUP_SIZE_LIMITS.maxWidth);
  currentPopupHeight = clampNumber(height, POPUP_SIZE_LIMITS.minHeight, POPUP_SIZE_LIMITS.maxHeight);
  document.documentElement.style.setProperty('--popup-width', `${currentPopupWidth}px`);
  document.documentElement.style.setProperty('--popup-height', `${currentPopupHeight}px`);

  if (persist) {
    chrome.storage.local.set({
      popupWidth: currentPopupWidth,
      popupHeight: currentPopupHeight,
    });
  }
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}
