(function () {
  'use strict';

  const DOW_LABEL = { 'Пн': 'Понеделник', 'Вт': 'Вторник', 'Ср': 'Сряда', 'Чт': 'Четвъртък', 'Пт': 'Петък', 'Сб': 'Събота' };
  const GROUP_OPTIONS = ['201А', '201Б', '202А', '202Б', '203'];
  const DEFAULT_GROUPS = GROUP_OPTIONS.slice(); // all groups shown until the user narrows it down

  const state = {
    data: null,
    selectedGroups: loadSelectedGroups(),
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
    bottomFab: document.getElementById('bottomFab'),
    todayFab: document.getElementById('todayFab'),
    footerNote: document.getElementById('footerNote'),
    sourceLink: document.getElementById('sourceLink'),
    menuToggle: document.getElementById('menuToggle'),
    controlsPanel: document.getElementById('controlsPanel'),
  };

  function parentGroup(g) {
    const m = g.match(/^(\d+)[АБ]$/);
    return m ? m[1] : g;
  }

  function updateHeaderHeightVar() {
    const h = document.querySelector('.topbar').offsetHeight;
    document.documentElement.style.setProperty('--header-h', h + 'px');
  }
  window.addEventListener('resize', updateHeaderHeightVar);
  window.addEventListener('load', updateHeaderHeightVar);

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

  function emptyState(msg) {
    const el = document.createElement('div');
    el.className = 'empty-state';
    el.innerHTML = `<div class="big">🗓️</div><div>${msg}</div>`;
    return el;
  }

  // The day we auto-jump to on load and that the "Днес" button returns to:
  // today itself, or if nothing is scheduled today, the nearest upcoming
  // day (or the most recent past day if the semester is already over).
  let anchorDayEl = null;

  function renderList(isInitial) {
    const events = state.data.events
      .filter(eventMatchesSelection)
      .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));

    const byDate = new Map();
    for (const ev of events) {
      if (!byDate.has(ev.date)) byDate.set(ev.date, []);
      byDate.get(ev.date).push(ev);
    }

    const list = document.createElement('div');
    list.className = 'agenda-list';
    const today = todayISO();
    anchorDayEl = null;

    for (const [date, dayEvents] of byDate) {
      const dayEl = document.createElement('div');
      dayEl.className = 'agenda-day' + (date === today ? ' is-today' : '');
      dayEl.dataset.date = date;
      if (date === today) anchorDayEl = dayEl;
      if (date >= today && !anchorDayEl) anchorDayEl = dayEl;

      const d = new Date(date + 'T00:00:00');
      const dowShort = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][d.getDay()];
      const head = document.createElement('div');
      head.className = 'agenda-day-head';
      head.innerHTML = `<span class="wd">${DOW_LABEL[dowShort] || dowShort}</span><span>${d.getDate()}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}</span>`;
      dayEl.appendChild(head);

      const evWrap = document.createElement('div');
      evWrap.className = 'agenda-events';
      dayEvents.forEach(ev => evWrap.appendChild(eventCard(ev)));
      dayEl.appendChild(evWrap);

      list.appendChild(dayEl);
    }
    if (!anchorDayEl) anchorDayEl = list.lastElementChild; // semester is over — anchor to the last day

    els.viewRoot.innerHTML = '';
    if (events.length === 0) {
      els.viewRoot.appendChild(emptyState('Няма намерени занятия за избраните групи.'));
      return;
    }
    els.viewRoot.appendChild(list);
    if (isInitial) {
      setTimeout(() => jumpToElement(anchorDayEl), 0);
    }
  }

  // Jump instantly to an element, landing just below the sticky header.
  // (`scrollIntoView({behavior:'smooth'})` is unreliable in some embedded
  // WebViews, so this does the offset math itself.)
  function jumpToElement(el) {
    if (!el) return;
    const headerH = document.querySelector('.topbar').offsetHeight;
    const targetY = el.getBoundingClientRect().top + window.scrollY - (headerH + 10);
    window.scrollTo(0, Math.max(0, targetY));
  }

  // The two floating buttons (jump-to-bottom, jump-to-today) appear while
  // the page is being scrolled and for ~3s after it stops, then fade out.
  // They stay suppressed until the user actually touches/scrolls the page
  // themselves, so the initial automatic jump-to-today on load (and any
  // late layout shift, e.g. from web fonts swapping in) never triggers them.
  let userHasInteracted = false;
  let scrollHideTimer = null;
  function showScrollButtons() {
    els.bottomFab.classList.add('show');
    els.todayFab.classList.add('show');
    clearTimeout(scrollHideTimer);
    scrollHideTimer = setTimeout(() => {
      els.bottomFab.classList.remove('show');
      els.todayFab.classList.remove('show');
    }, 3000);
  }
  ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(type => {
    window.addEventListener(type, () => { userHasInteracted = true; }, { passive: true, once: true });
  });
  window.addEventListener('scroll', () => {
    if (userHasInteracted) showScrollButtons();
  }, { passive: true });

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
    renderList(false);
  }

  function init() {
    fetch('data/events.json', { cache: 'no-cache' })
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(data => {
        state.data = data;
        updateHeaderHeightVar();
        renderGroupToggle();
        renderList(true);

        const gen = new Date(data.meta.generatedAt);
        els.footerNote.innerHTML = `${data.meta.specialty} · ${data.meta.semester}<br>данните са обновени на ${gen.toLocaleDateString('bg-BG')}`;
        if (data.meta.sourceUrl) els.sourceLink.href = data.meta.sourceUrl;
      })
      .catch(err => {
        els.viewRoot.innerHTML = '';
        els.viewRoot.appendChild(emptyState('Неуспешно зареждане на програмата. Опитайте да презаредите страницата.'));
        els.footerNote.textContent = 'Грешка при зареждане на данните.';
        console.error(err);
      });
  }

  els.bottomFab.addEventListener('click', () => window.scrollTo(0, document.body.scrollHeight));
  els.todayFab.addEventListener('click', () => jumpToElement(anchorDayEl));

  els.menuToggle.addEventListener('click', () => {
    const open = els.controlsPanel.classList.toggle('open');
    els.menuToggle.setAttribute('aria-expanded', String(open));
    updateHeaderHeightVar(); // opening/closing the mobile menu changes the header's height
  });

  const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator) {
    if (isLocalDev) {
      // Never run the SW in local dev — a stale cached app.js/style.css from
      // an earlier test would otherwise keep being served over new edits.
      navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
      if (window.caches) caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
    } else {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => { /* offline install not critical */ });
      });
    }
  }

  init();
})();
