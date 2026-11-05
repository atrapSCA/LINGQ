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
const panelStats = document.getElementById('panel-stats');
const wordSearchInput = document.getElementById('word-search');
const wordSortInput = document.getElementById('word-sort');
const wordsMeta = document.getElementById('words-meta');
const wordsList = document.getElementById('words-list');
const statsPeriodInput = document.getElementById('stats-period');
const statsMeta = document.getElementById('stats-meta');
const statsHeatmap = document.getElementById('stats-heatmap');
const statsHeatmapMonths = document.getElementById('stats-heatmap-months');
const statsTableBody = document.querySelector('#stats-table tbody');
const resizeHandle = document.getElementById('resize-handle');

let allWords = [];
let wordsLoaded = false;
let wordsLoading = false;
let statsLoading = false;
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

statsPeriodInput.addEventListener('change', () => {
  loadStats(true);
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
  tabButtons.forEach((button) => {
    const active = button.dataset.tab === tabName;
    button.classList.toggle('tab--active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  panelSettings.hidden = tabName !== 'settings';
  panelWords.hidden = tabName !== 'words';
  panelStats.hidden = tabName !== 'stats';
  if (tabName === 'words') {
    loadWords(false);
  }
  if (tabName === 'stats') {
    loadStats(false);
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

function loadStats(force) {
  if (statsLoading) {
    return;
  }
  if (!force && statsHeatmap.dataset.loaded === statsPeriodInput.value) {
    return;
  }

  statsLoading = true;
  statsMeta.textContent = 'Načítám statistiky…';
  statsHeatmap.innerHTML = '';
  statsTableBody.innerHTML = '';

  chrome.runtime.sendMessage({ type: 'GET_USAGE_STATS', period: statsPeriodInput.value }, (response) => {
    statsLoading = false;
    if (chrome.runtime.lastError || !response?.ok) {
      statsHeatmap.dataset.loaded = '';
      statsMeta.textContent = '';
      statsHeatmap.innerHTML = `<div class="words-empty">${response?.error || chrome.runtime.lastError?.message || 'Statistiky se nepodařilo načíst.'}</div>`;
      return;
    }
    statsHeatmap.dataset.loaded = statsPeriodInput.value;
    renderStats(response.stats || {});
  });
}

function renderStats(stats) {
  const daysMap = new Map((stats.days || []).map((item) => [String(item.day).slice(0, 10), Number(item.clicks) || 0]));
  const rangeStart = new Date(stats.rangeStart || stats.from);
  const rangeEnd = new Date(stats.rangeEnd || stats.to);
  const dayList = buildDayList(rangeStart, rangeEnd);
  const maxClicks = Math.max(0, ...dayList.map((day) => daysMap.get(day) || 0));
  const clicks = Number(stats.clicks) || 0;
  const activeDays = Number(stats.active_days) || 0;
  const avg = activeDays > 0 ? (clicks / activeDays) : 0;
  const top = dayList
    .map((day) => ({ day, clicks: daysMap.get(day) || 0 }))
    .sort((a, b) => b.clicks - a.clicks)[0];

  statsMeta.textContent = `${formatShortDate(rangeStart)} – ${formatShortDate(rangeEnd)} · ${clicks} kliknutí`;
  renderTinyHeatmap(dayList, daysMap, maxClicks);

  const rows = [
    ['Kliknutí ve zvoleném období', String(clicks)],
    ['Aktivní dny', String(activeDays)],
    ['Průměr kliknutí / aktivní den', avg ? avg.toFixed(1).replace('.', ',') : '0'],
    ['Nejaktivnější den', top && top.clicks ? `${formatShortDate(new Date(`${top.day}T12:00:00`))} (${top.clicks}×)` : '—'],
    ['Přidáno slovíček', String(Number(stats.added) || 0)],
    ['Upraveno slovíček', String(Number(stats.edited) || 0)],
    ['Celkem slovíček ve slovníku', String(Number(stats.total_words) || 0)],
    ['Znalost 1', String(Number(stats.status_1) || 0)],
    ['Znalost 2', String(Number(stats.status_2) || 0)],
    ['Znalost 3', String(Number(stats.status_3) || 0)],
    ['Znalost 4', String(Number(stats.status_4) || 0)],
    ['Znalost K', String(Number(stats.status_5) || 0)],
  ];

  statsTableBody.innerHTML = '';
  rows.forEach(([label, value]) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = label;
    const td = document.createElement('td');
    td.textContent = value;
    tr.append(th, td);
    statsTableBody.appendChild(tr);
  });
}

function renderTinyHeatmap(dayList, daysMap, maxClicks) {
  statsHeatmap.innerHTML = '';
  if (statsHeatmapMonths) {
    statsHeatmapMonths.innerHTML = '';
  }
  if (!dayList.length) {
    return;
  }

  const firstOffset = weekdayIndex(dayList[0]);
  const cells = [];
  for (let i = 0; i < firstOffset; i += 1) {
    cells.push(null);
  }
  dayList.forEach((day) => cells.push(day));
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  const weekCount = cells.length / 7;
  const heatmapWrap = statsHeatmap.closest('.heatmap-wrap');
  if (heatmapWrap) {
    heatmapWrap.style.setProperty('--heatmap-weeks', String(weekCount));
  }
  statsHeatmap.style.setProperty('--heatmap-weeks', String(weekCount));

  for (let week = 0; week < weekCount; week += 1) {
    const column = document.createElement('div');
    column.className = 'heatmap-week';
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const day = cells[week * 7 + weekday];
      const cell = document.createElement(day ? 'button' : 'span');
      if (day) {
        const count = daysMap.get(day) || 0;
        cell.type = 'button';
        cell.className = `heat heat-${heatLevel(count, maxClicks)}`;
        cell.title = `${formatShortDate(new Date(`${day}T12:00:00`))}: ${count}×`;
        cell.setAttribute('aria-label', cell.title);
      } else {
        cell.className = 'heat heat-empty';
      }
      column.appendChild(cell);
    }
    statsHeatmap.appendChild(column);
  }

  if (!statsHeatmapMonths) {
    return;
  }

  let lastMonthKey = '';
  for (let week = 0; week < weekCount; week += 1) {
    const label = document.createElement('span');
    label.className = 'heatmap-month';
    const weekDays = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const day = cells[week * 7 + weekday];
      if (day) {
        weekDays.push(day);
      }
    }
    const anchor = weekDays[0];
    if (anchor) {
      const date = new Date(`${anchor}T12:00:00`);
      const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
      if (monthKey !== lastMonthKey) {
        label.textContent = new Intl.DateTimeFormat('cs-CZ', { month: 'short' }).format(date);
        lastMonthKey = monthKey;
      }
    }
    statsHeatmapMonths.appendChild(label);
  }
}

function buildDayList(start, end) {
  const days = [];
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return days;
  }
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor <= last) {
    days.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekdayIndex(dayKey) {
  const date = new Date(`${dayKey}T12:00:00`);
  return (date.getDay() + 6) % 7;
}

function heatLevel(count, maxClicks) {
  if (!count) {
    return 0;
  }
  if (!maxClicks || maxClicks <= 1) {
    return 1;
  }
  const ratio = count / maxClicks;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function formatShortDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
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
