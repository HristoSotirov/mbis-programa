(function () {
  'use strict';

  const DOW_SHORT_ORDER = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const GROUP_OPTIONS = ['201А', '201Б', '202А', '202Б', '203'];
  const DEFAULT_GROUPS = ['201А', '201Б'];

  const state = {
    data: null,
    selectedGroups: loadSelectedGroups(),
    weekIndex: 0, // index into data.weeks
  };

  function loadSelectedGroups() {
    try {
      const raw = JSON.parse(localStorage.getItem('mbis.groups'));
      if (Array.isArray(raw) && raw.length && raw.every(g => GROUP_OPTIONS.includes(g))) return raw;
    } catch (e) { /* ignore */ }
    return DEFAULT_GROUPS.slice();
  }
  function saveSelectedGroups() {
    localStorage.setItem('mbis.groups', JSON.stringify(state.selectedGroups));
  }

  const els = {
    groupToggle: document.getElementById('groupToggle'),
    viewRoot: document.getElementById('viewRoot'),
    weekTitle: document.getElementById('weekTitle'),
    weekRange: document.getElementById('weekRange'),
    prevWeek: document.getElementById('prevWeek'),
    nextWeek: document.getElementById('nextWeek'),
    todayBtn: document.getElementById('todayBtn'),
    footerNote: document.getElementById('footerNote'),
    sourceLink: document.getElementById('sourceLink'),
    toast: document.getElementById('toast'),
    menuToggle: document.getElementById('menuToggle'),
    controlsPanel: document.getElementById('controlsPanel'),
  };

  function parentGroup(g) {
    const m = g.match(/^(\d+)[АБ]$/);
    return m ? m[1] : g;
  }

  function fmtDateHuman(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit' });
  }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  const COLOR_PALETTE = ['#1d6fd1', '#1a7a4c', '#b1452c', '#6a3fb5', '#c0860a', '#1595a3', '#c23a74', '#3b6b1f'];
  const colorCache = new Map();
  function colorForSubject(key) {
    if (colorCache.has(key)) return colorCache.get(key);
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    const c = COLOR_PALETTE[hash % COLOR_PALETTE.length];
    colorCache.set(key, c);
    return c;
  }

  function eventMatchesSelection(ev) {
    return state.selectedGroups.some(g => {
      const p = parentGroup(g);
      return ev.groupTokens.includes(g) || ev.groupTokens.includes(p);
    });
  }

  function currentWeekEvents() {
    const wk = state.data.weeks[state.weekIndex];
    return state.data.events
      .filter(ev => ev.week === wk.n && eventMatchesSelection(ev))
      .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  }

  function eventCard(ev) {
    const card = document.createElement('div');
    card.className = 'event-card';
    card.style.setProperty('--course-color', colorForSubject(ev.subject));

    const time = document.createElement('div');
    time.className = 'event-time';
    time.textContent = ev.start + '–' + ev.end;

    const body = document.createElement('div');
    body.className = 'event-body';

    const subj = document.createElement('div');
    subj.className = 'event-subject';
    subj.textContent = ev.subject;
    body.appendChild(subj);

    const meta = document.createElement('div');
    meta.className = 'event-meta';

    const typeBadge = document.createElement('span');
    const isLecture = /лек/i.test(ev.type);
    typeBadge.className = 'badge ' + (isLecture ? 'badge-lecture' : 'badge-lab');
    typeBadge.textContent = isLecture ? 'Лекция' : 'Упражнение';
    meta.appendChild(typeBadge);

    const roomSpan = document.createElement('span');
    roomSpan.className = 'event-sub';
    roomSpan.textContent = '📍 ' + (ev.room || '—');
    meta.appendChild(roomSpan);

    const groupBadge = document.createElement('span');
    groupBadge.className = 'event-group-badge';
    groupBadge.textContent = ev.group;
    meta.appendChild(groupBadge);

    body.appendChild(meta);

    const teacher = document.createElement('div');
    teacher.className = 'event-sub';
    teacher.style.marginTop = '4px';
    teacher.textContent = ev.teacher;
    body.appendChild(teacher);

    card.appendChild(time);
    card.appendChild(body);
    return card;
  }

  function renderWeekView() {
    const wk = state.data.weeks[state.weekIndex];
    const events = currentWeekEvents();
    const byDate = new Map();
    for (const ev of events) {
      if (!byDate.has(ev.date)) byDate.set(ev.date, []);
      byDate.get(ev.date).push(ev);
    }

    const grid = document.createElement('div');
    grid.className = 'week-grid';
    const today = todayISO();

    DOW_SHORT_ORDER.forEach((dow, i) => {
      const date = addDaysISO(wk.start, i);
      const col = document.createElement('div');
      col.className = 'day-col' + (date === today ? ' is-today' : '');

      const head = document.createElement('div');
      head.className = 'day-head';
      const d = new Date(date + 'T00:00:00');
      head.innerHTML = `<div class="dow">${dow}</div><div class="dnum">${d.getDate()}.${String(d.getMonth()+1).padStart(2,'0')}</div>`;
      col.appendChild(head);

      const dayEvents = (byDate.get(date) || []);
      if (dayEvents.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'day-empty';
        empty.textContent = '—';
        col.appendChild(empty);
      } else {
        dayEvents.forEach(ev => col.appendChild(eventCard(ev)));
      }
      grid.appendChild(col);
    });

    els.viewRoot.innerHTML = '';
    if (events.length === 0) {
      els.viewRoot.appendChild(emptyState('Няма занятия тази седмица за избраните групи.'));
    } else {
      els.viewRoot.appendChild(grid);
    }
  }

  function emptyState(msg) {
    const el = document.createElement('div');
    el.className = 'empty-state';
    el.innerHTML = `<div class="big">🗓️</div><div>${msg}</div>`;
    return el;
  }

  function addDaysISO(iso, n) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function updateWeekNav() {
    const wk = state.data.weeks[state.weekIndex];
    els.weekTitle.textContent = 'Седмица ' + wk.n;
    const end = addDaysISO(wk.start, 5);
    els.weekRange.textContent = fmtDateHuman(wk.start) + '–' + fmtDateHuman(end) + '.' + wk.start.slice(0, 4);
    els.prevWeek.disabled = state.weekIndex === 0;
    els.nextWeek.disabled = state.weekIndex === state.data.weeks.length - 1;
  }

  function render() {
    updateWeekNav();
    renderWeekView();
  }

  function findCurrentWeekIndex() {
    const today = todayISO();
    const weeks = state.data.weeks;
    for (let i = 0; i < weeks.length; i++) {
      const wkEnd = addDaysISO(weeks[i].start, 6);
      if (today >= weeks[i].start && today < wkEnd) return i;
      if (today < weeks[i].start) return i;
    }
    return weeks.length - 1;
  }

  function renderGroupToggle() {
    els.groupToggle.innerHTML = '';
    GROUP_OPTIONS.forEach(g => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'group-chip' + (state.selectedGroups.includes(g) ? ' active' : '');
      btn.textContent = g;
      btn.addEventListener('click', () => toggleGroup(g));
      els.groupToggle.appendChild(btn);
    });
  }

  function toggleGroup(g) {
    const idx = state.selectedGroups.indexOf(g);
    if (idx >= 0) {
      if (state.selectedGroups.length === 1) return; // keep at least one selected
      state.selectedGroups.splice(idx, 1);
    } else {
      state.selectedGroups.push(g);
    }
    saveSelectedGroups();
    renderGroupToggle();
    render();
  }

  function init() {
    fetch('data/events.json', { cache: 'no-cache' })
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(data => {
        state.data = data;
        renderGroupToggle();
        state.weekIndex = findCurrentWeekIndex();
        render();

        const gen = new Date(data.meta.generatedAt);
        els.footerNote.textContent = `${data.meta.specialty} · ${data.meta.semester} · данните са обновени на ${gen.toLocaleDateString('bg-BG')}`;
        if (data.meta.sourceUrl) els.sourceLink.href = data.meta.sourceUrl;
      })
      .catch(err => {
        els.viewRoot.innerHTML = '';
        els.viewRoot.appendChild(emptyState('Неуспешно зареждане на програмата. Опитайте да презаредите страницата.'));
        els.footerNote.textContent = 'Грешка при зареждане на данните.';
        console.error(err);
      });
  }

  els.prevWeek.addEventListener('click', () => {
    if (state.weekIndex > 0) { state.weekIndex--; render(); }
  });
  els.nextWeek.addEventListener('click', () => {
    if (state.weekIndex < state.data.weeks.length - 1) { state.weekIndex++; render(); }
  });
  els.todayBtn.addEventListener('click', () => {
    state.weekIndex = findCurrentWeekIndex();
    render();
  });

  els.menuToggle.addEventListener('click', () => {
    const open = els.controlsPanel.classList.toggle('open');
    els.menuToggle.setAttribute('aria-expanded', String(open));
  });

  init();
})();
