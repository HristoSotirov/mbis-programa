(function () {
  'use strict';

  const DOW_LABEL = { 'Пн': 'Понеделник', 'Вт': 'Вторник', 'Ср': 'Сряда', 'Чт': 'Четвъртък', 'Пт': 'Петък', 'Сб': 'Събота' };
  const DOW_SHORT_ORDER = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

  const state = {
    data: null,
    group: localStorage.getItem('mbis.group') || '201',
    showAll: localStorage.getItem('mbis.showAll') === '1',
    view: localStorage.getItem('mbis.view') || 'week',
    weekIndex: 0, // index into data.weeks
  };

  const els = {
    groupSelect: document.getElementById('groupSelect'),
    showAllCheckbox: document.getElementById('showAllCheckbox'),
    viewRoot: document.getElementById('viewRoot'),
    weekTitle: document.getElementById('weekTitle'),
    weekRange: document.getElementById('weekRange'),
    prevWeek: document.getElementById('prevWeek'),
    nextWeek: document.getElementById('nextWeek'),
    todayBtn: document.getElementById('todayBtn'),
    footerNote: document.getElementById('footerNote'),
    toast: document.getElementById('toast'),
    menuToggle: document.getElementById('menuToggle'),
    controlsPanel: document.getElementById('controlsPanel'),
    toggleBtns: Array.from(document.querySelectorAll('.toggle-btn')),
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

  function eventMatchesGroup(ev, group) {
    if (state.showAll) return true;
    const p = parentGroup(group);
    return ev.groupTokens.includes(group) || ev.groupTokens.includes(p);
  }

  function currentWeekEvents() {
    const wk = state.data.weeks[state.weekIndex];
    return state.data.events
      .filter(ev => ev.week === wk.n && eventMatchesGroup(ev, state.group))
      .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  }

  function eventCard(ev, { compact } = {}) {
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

    if (ev.groupTokens.length > 1) {
      const multi = document.createElement('span');
      multi.className = 'event-multigroup';
      multi.textContent = 'общо: ' + ev.group;
      meta.appendChild(multi);
    } else if (state.showAll) {
      const g = document.createElement('span');
      g.className = 'event-group-tag';
      g.textContent = 'гр. ' + ev.group;
      meta.appendChild(g);
    }

    body.appendChild(meta);

    if (!compact) {
      const teacher = document.createElement('div');
      teacher.className = 'event-sub';
      teacher.style.marginTop = '4px';
      teacher.textContent = ev.teacher;
      body.appendChild(teacher);
    }

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
      els.viewRoot.appendChild(emptyState('Няма занятия тази седмица за избраната група.'));
    } else {
      els.viewRoot.appendChild(grid);
    }
  }

  function renderAgendaView() {
    const events = state.data.events
      .filter(ev => eventMatchesGroup(ev, state.group))
      .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));

    const byDate = new Map();
    for (const ev of events) {
      if (!byDate.has(ev.date)) byDate.set(ev.date, []);
      byDate.get(ev.date).push(ev);
    }

    const list = document.createElement('div');
    list.className = 'agenda-list';
    const today = todayISO();
    let scrollTarget = null;

    for (const [date, dayEvents] of byDate) {
      const dayEl = document.createElement('div');
      dayEl.className = 'agenda-day' + (date === today ? ' is-today' : '');
      if (date >= today && !scrollTarget) scrollTarget = dayEl;

      const d = new Date(date + 'T00:00:00');
      const dowShort = DOW_SHORT_ORDER[(d.getDay() + 6) % 7];
      const head = document.createElement('div');
      head.className = 'agenda-day-head';
      head.innerHTML = `<span class="wd">${DOW_LABEL[dowShort]}</span><span>${d.getDate()}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}</span>`;
      dayEl.appendChild(head);

      const evWrap = document.createElement('div');
      evWrap.className = 'agenda-events';
      dayEvents.forEach(ev => evWrap.appendChild(eventCard(ev, { compact: true })));
      dayEl.appendChild(evWrap);

      list.appendChild(dayEl);
    }

    els.viewRoot.innerHTML = '';
    if (events.length === 0) {
      els.viewRoot.appendChild(emptyState('Няма намерени занятия за избраната група.'));
    } else {
      els.viewRoot.appendChild(list);
      if (scrollTarget) {
        requestAnimationFrame(() => scrollTarget.scrollIntoView({ block: 'start' }));
      }
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
    if (state.view === 'week') {
      document.querySelector('.week-nav').style.display = '';
      updateWeekNav();
      renderWeekView();
    } else {
      document.querySelector('.week-nav').style.display = 'none';
      renderAgendaView();
    }
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

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => els.toast.classList.remove('show'), 3200);
  }

  function populateGroupSelect() {
    els.groupSelect.innerHTML = '';
    state.data.groups.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g;
      opt.textContent = 'Група ' + g;
      els.groupSelect.appendChild(opt);
    });
    if (!state.data.groups.includes(state.group)) state.group = state.data.groups[0];
    els.groupSelect.value = state.group;
  }

  function setView(view) {
    state.view = view;
    localStorage.setItem('mbis.view', view);
    els.toggleBtns.forEach(b => b.classList.toggle('active', b.dataset.view === view));
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
        populateGroupSelect();
        els.showAllCheckbox.checked = state.showAll;
        state.weekIndex = findCurrentWeekIndex();
        setView(state.view);
        render();

        const gen = new Date(data.meta.generatedAt);
        els.footerNote.textContent = `${data.meta.specialty} · ${data.meta.semester} · данните са обновени на ${gen.toLocaleDateString('bg-BG')}`;
      })
      .catch(err => {
        els.viewRoot.innerHTML = '';
        els.viewRoot.appendChild(emptyState('Неуспешно зареждане на разписа. Опитайте да презаредите страницата.'));
        els.footerNote.textContent = 'Грешка при зареждане на данните.';
        console.error(err);
      });
  }

  els.groupSelect.addEventListener('change', () => {
    state.group = els.groupSelect.value;
    localStorage.setItem('mbis.group', state.group);
    render();
  });

  els.showAllCheckbox.addEventListener('change', () => {
    state.showAll = els.showAllCheckbox.checked;
    localStorage.setItem('mbis.showAll', state.showAll ? '1' : '0');
    render();
  });

  els.toggleBtns.forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));

  els.prevWeek.addEventListener('click', () => {
    if (state.weekIndex > 0) { state.weekIndex--; render(); }
  });
  els.nextWeek.addEventListener('click', () => {
    if (state.weekIndex < state.data.weeks.length - 1) { state.weekIndex++; render(); }
  });
  els.todayBtn.addEventListener('click', () => {
    if (state.view !== 'week') setView('week');
    state.weekIndex = findCurrentWeekIndex();
    render();
  });

  els.menuToggle.addEventListener('click', () => {
    const open = els.controlsPanel.classList.toggle('open');
    els.menuToggle.setAttribute('aria-expanded', String(open));
  });

  init();
})();
