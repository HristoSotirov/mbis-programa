#!/usr/bin/env node
/**
 * Parses the TU-Sofia MBIS weekly-grid schedule PDF into data/events.json.
 *
 * The source PDF is a dense table: one row per (discipline, group) pair,
 * 13 "week" columns showing which weekdays have class that week and how
 * many academic hours. This script extracts word positions via
 * `pdftotext -bbox-layout` (poppler-utils), reconstructs the table grid
 * from those coordinates, and expands it into a flat list of calendar
 * events with real dates.
 *
 * Usage: node parse-schedule.js <schedule.pdf> <output-events.json> [<weeks.json>]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const [, , pdfPath, outPath, weeksPathArg] = process.argv;
if (!pdfPath || !outPath) {
  console.error('Usage: node parse-schedule.js <schedule.pdf> <output-events.json> [<weeks.json>]');
  process.exit(1);
}

// ---------- 1. Extract word bounding boxes from the PDF ----------

const bboxPath = path.join(os.tmpdir(), 'schedule-bbox-' + Date.now() + '.xml');
execFileSync('pdftotext', ['-bbox-layout', pdfPath, bboxPath]);
const xml = fs.readFileSync(bboxPath, 'utf8');
fs.unlinkSync(bboxPath);

// The source spreadsheet occasionally mixes Latin look-alike letters into
// group/room codes (e.g. "202A" with a Latin A next to "202А" in Cyrillic).
// Normalise any letter glued to a digit to its Cyrillic twin so the same
// group never shows up twice.
const LATIN_TO_CYRILLIC = {
  A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х',
  a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х',
};
function normalizeCode(s) {
  return s.replace(/(\d)([A-Za-zА-Яа-я]+)/g, (_, d, letters) =>
    d + letters.replace(/[A-Za-z]/g, ch => LATIN_TO_CYRILLIC[ch] || ch));
}

// Plain reading-order text, used to pick up the "room change" footnotes
// printed below the table. We resolve these into a concrete room per
// weekday instead of showing the raw "3401/3501*" to the user. Two
// wordings have been seen in the official PDF:
//   "* Лекции в понеделник: зала 3401; в останалите дни: 3501."
//   "* лекциите в понеделник са в зала 3401."  (other days implied: the
//   remaining room of the "3401/3501*" pair)
// A room cell can also carry the note inline: "2101В/4130А-събота".
const plainText = normalizeCode(execFileSync('pdftotext', [pdfPath, '-']).toString('utf8'));
const DAY_NAME_BG = { 'понеделник': 'Пн', 'вторник': 'Вт', 'сряда': 'Ср', 'четвъртък': 'Чт', 'петък': 'Пт', 'събота': 'Сб' };
const roomRules = {}; // asterisk-count -> { specialDay, specialRoom, otherRoom? }
{
  const footnoteRe = /(\*+)\s*(?:Лекции(?:те)?|Лаб\.\s*(?:упражнения|упр\.))\s+(?:в|във)\s+(понеделник|вторник|сряда|четвъртък|петък|събота)(?:\s+са\s+в)?[:\s]+(?:(?:зала|з\.)\s*)?([^\s;]*[^\s;.])(?:\s*;\s*в\s+останалите\s+дни:\s*([^\s;]*[^\s;.]))?/giu;
  let fm;
  while ((fm = footnoteRe.exec(plainText))) {
    roomRules[fm[1].length] = { specialDay: DAY_NAME_BG[fm[2].toLowerCase()], specialRoom: fm[3], otherRoom: fm[4] };
  }
}
function pickRoom(base, rule, day) {
  const tokens = base.split('/').map(s => s.trim());
  if (!tokens.includes(rule.specialRoom)) return base;
  let otherRoom = rule.otherRoom;
  if (!otherRoom) {
    const rest = tokens.filter(t => t !== rule.specialRoom);
    if (rest.length !== 1) return base;
    otherRoom = rest[0];
  }
  if (!tokens.includes(otherRoom)) return base;
  return day === rule.specialDay ? rule.specialRoom : otherRoom;
}
function resolveRoom(rawRoom, day) {
  if (!rawRoom) return rawRoom;
  const inline = rawRoom.match(/^(.*\/)?([^/]+?)\s*-\s*(понеделник|вторник|сряда|четвъртък|петък|събота)$/i);
  if (inline) {
    const special = inline[2].trim();
    return pickRoom((inline[1] || '') + special, { specialDay: DAY_NAME_BG[inline[3].toLowerCase()], specialRoom: special }, day);
  }
  const starMatch = rawRoom.match(/(\*+)\s*$/);
  if (!starMatch) return rawRoom;
  const rule = roomRules[starMatch[1].length];
  const base = rawRoom.slice(0, starMatch.index).trim();
  if (!rule) return base; // unknown footnote marker — at least drop the stray asterisks
  return pickRoom(base, rule, day);
}

const wordRe = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;
const words = [];
let m;
while ((m = wordRe.exec(xml))) {
  words.push({
    x0: parseFloat(m[1]), y0: parseFloat(m[2]),
    x1: parseFloat(m[3]), y1: parseFloat(m[4]),
    text: m[5].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
  });
}

// ---------- 2. Reconstruct the table grid ----------
// The PDF's layout (margins, column widths, font size) has changed between
// versions, so nothing here relies on fixed coordinates:
//  * week columns are located from the centred "СЕДМИЦА N" header labels;
//  * each table row is anchored on its start-time words ("16:30", "8:30");
//  * the left-hand cells are told apart by content and order: № and
//    discipline, then the type (Л/ЛУ/Лекция), teacher, group, room, and the
//    weekday/Saturday start times.

const TIME_RE = /^\d{1,2}:\d{2}$/;
const GROUP_RE = /^\d{3}[A-Za-zА-Яа-я]?(?:\/\d{3}[A-Za-zА-Яа-я]?)*$/;
const TYPE_RE = /^(?:Л|ЛУ|Лекция|Лаб\.?|Упр\.?|СУ|Семинар)$/;

function layoutError(msg) {
  return new Error(msg + ' — PDF layout may have changed, parser needs review.');
}

const weekHeaders = words.filter(w => w.text === 'СЕДМИЦА').sort((a, b) => a.x0 - b.x0);
if (weekHeaders.length !== 13) throw layoutError(`Found ${weekHeaders.length} "СЕДМИЦА" headers instead of 13`);
const weekCenters = weekHeaders.map(h => {
  const num = words.find(w => /^\d+$/.test(w.text) && Math.abs(w.y0 - h.y0) < 2 && w.x0 > h.x1 && w.x0 - h.x1 < 15);
  return (h.x0 + (num ? num.x1 : h.x1)) / 2;
});
const weekPitch = (weekCenters[12] - weekCenters[0]) / 12;
const weekLeft = weekCenters.map((c, i) => (i === 0 ? c - weekPitch / 2 : (weekCenters[i - 1] + c) / 2));
const weekEnd = weekCenters[12] + weekPitch / 2;
const metaRight = weekLeft[0];

function weekColOf(x) {
  for (let i = 12; i >= 0; i--) if (x >= weekLeft[i]) return x < weekEnd ? 'w' + (i + 1) : '__end';
  return null;
}
const colOf = weekColOf;

// Body = everything between the header row and the footnotes.
const headerBottom = Math.max(
  ...weekHeaders.map(h => h.y1),
  ...words.filter(w => w.text === 'начало' && w.y0 < weekHeaders[0].y1 + 40).map(w => w.y1),
);
const footnoteTitle = words.find(w => w.text === 'ПРОМЕНИ' && w.y0 > headerBottom);
const bodyEnd = footnoteTitle ? footnoteTitle.y0 : Infinity;
const body = words.filter(w => w.y0 > headerBottom && w.y0 < bodyEnd);

// One anchor per table row: the leftmost start-time word on each line.
const timeWords = body.filter(w => w.x1 <= metaRight && TIME_RE.test(w.text)).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
const anchorWords = [];
for (const w of timeWords) {
  const last = anchorWords[anchorWords.length - 1];
  if (last && Math.abs(last.y0 - w.y0) < 4) continue;
  anchorWords.push(w);
}
if (anchorWords.length < 10) throw layoutError(`Only found ${anchorWords.length} table rows`);

const rowBands = anchorWords.map((a, i) => {
  const prev = anchorWords[i - 1], next = anchorWords[i + 1];
  const top = prev ? (prev.y0 + a.y0) / 2 : a.y0 - 20;
  const bottom = next ? (a.y0 + next.y0) / 2 : a.y0 + 20;
  return { y0: a.y0, top, bottom, metaWords: [], weekWords: [] };
});
function bandFor(y0) { return rowBands.find(r => y0 >= r.top && y0 < r.bottom); }

for (const w of body) {
  if (w.x0 >= metaRight) continue;
  const band = bandFor(w.y0);
  if (band) band.metaWords.push(w);
}
const readingOrder = (a, b) => (Math.abs(a.y0 - b.y0) < 4 ? a.x0 - b.x0 : a.y0 - b.y0);
const joinWords = ws => [...ws].sort(readingOrder).map(w => w.text).join(' ');
for (const band of rowBands) {
  const ws = band.metaWords;
  const times = ws.filter(w => TIME_RE.test(w.text)).sort((a, b) => a.x0 - b.x0);
  const groupW = ws.filter(w => GROUP_RE.test(w.text) && w.x1 <= times[0].x0).sort((a, b) => a.x0 - b.x0)[0];
  const typeW = ws.filter(w => TYPE_RE.test(w.text) && (!groupW || w.x1 <= groupW.x0)).sort((a, b) => a.x0 - b.x0)[0];
  if (!groupW || !typeW) {
    throw layoutError(`Could not find the group/type cells of the row "${joinWords(ws)}"`);
  }
  const left = ws.filter(w => w.x1 <= typeW.x0);
  const noW = left.filter(w => /^\d+$/.test(w.text)).sort((a, b) => a.x0 - b.x0)[0];
  band.meta = {
    no: noW ? noW.text : '',
    subject: joinWords(left.filter(w => w !== noW)),
    type: typeW.text,
    teacher: joinWords(ws.filter(w => w.x0 >= typeW.x1 && w.x1 <= groupW.x0)),
    group: groupW.text,
    room: joinWords(ws.filter(w => w.x0 >= groupW.x1 && w.x1 <= times[0].x0)).replace(/\s*\/\s*/g, '/'),
    weekday_start: times[0] ? times[0].text : '',
    saturday_start: times[1] ? times[1].text : '',
  };
}

for (const w of body) {
  if (!/^w\d+$/.test(colOf(w.x0))) continue;
  const band = bandFor(w.y0);
  if (band) band.weekWords.push(w);
}

for (const band of rowBands) {
  const sorted = [...band.weekWords].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lines = [];
  for (const w of sorted) {
    let line = lines.find(l => Math.abs(l.y0 - w.y0) < 4);
    if (!line) { line = { y0: w.y0, words: [] }; lines.push(line); }
    line.words.push(w);
  }
  lines.sort((a, b) => a.y0 - b.y0);
  for (const l of lines) {
    l.words.sort((a, b) => a.x0 - b.x0);
    const segs = [];
    for (const w of l.words) {
      const col = colOf(w.x0);
      let seg = segs[segs.length - 1];
      if (!seg || seg.col !== col) { seg = { col, words: [] }; segs.push(seg); }
      seg.words.push(w);
    }
    l.segs = segs.map(s => ({ col: s.col, text: s.words.map(w => w.text).join(' ') }));
  }
  const colText = {};
  let prevSingleCol = null;
  for (const l of lines) {
    if (l.segs.length === 1 && prevSingleCol === l.segs[0].col) {
      colText[l.segs[0].col].push(l.segs[0].text);
    } else {
      for (const seg of l.segs) {
        colText[seg.col] = colText[seg.col] || [];
        colText[seg.col].push(seg.text);
      }
    }
    prevSingleCol = l.segs.length === 1 ? l.segs[0].col : null;
  }
  band.week = {};
  for (const [col, pieces] of Object.entries(colText)) band.week[col] = pieces.join(' | ');
}

const TYPE_FULL = { 'Л': 'Лекция' }; // newer PDFs abbreviate "Лекция" to "Л"
const rows = rowBands.map(band => {
  const rec = { ...band.meta };
  rec.type = TYPE_FULL[rec.type] || rec.type;
  rec.group = normalizeCode(rec.group);
  rec.room = normalizeCode(rec.room);
  for (let n = 1; n <= 13; n++) rec['w' + n] = (band.week && band.week['w' + n]) || '';
  return rec;
});

// ---------- 3. Expand rows into dated events ----------

const defaultWeeks = [
  { n: 1, start: '2026-10-05' }, { n: 2, start: '2026-10-12' }, { n: 3, start: '2026-10-19' },
  { n: 4, start: '2026-10-26' }, { n: 5, start: '2026-11-02' }, { n: 6, start: '2026-11-09' },
  { n: 7, start: '2026-11-16' }, { n: 8, start: '2026-11-23' }, { n: 9, start: '2026-11-30' },
  { n: 10, start: '2026-12-07' }, { n: 11, start: '2026-12-14' }, { n: 12, start: '2027-01-04' },
  { n: 13, start: '2027-01-11' },
];
const WEEKS = weeksPathArg && fs.existsSync(weeksPathArg)
  ? JSON.parse(fs.readFileSync(weeksPathArg, 'utf8'))
  : defaultWeeks;

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const DAY_OFFSET = { 'Пн': 0, 'Вт': 1, 'Ср': 2, 'Чт': 3, 'Пт': 4, 'Сб': 5 };
const ACADEMIC_HOUR_MIN = 45;
const BREAK_MIN = 15; // between consecutive academic hours within the same block (not after the last one)
function blockDurationMin(hours) {
  return hours * ACADEMIC_HOUR_MIN + Math.max(0, hours - 1) * BREAK_MIN;
}

function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// "Пн-Сб", "Пн, Вт, Пт", "Пн/Вт/Чт/Пт", and mixes such as "Пн, Ср-Пт".
function expandDaySpec(spec) {
  const out = [];
  for (const part of spec.split(/[,/]/).map(s => s.trim()).filter(Boolean)) {
    const rangeMatch = part.match(/^(Пн|Вт|Ср|Чт|Пт|Сб)\s*[–-]\s*(Пн|Вт|Ср|Чт|Пт|Сб)$/);
    if (rangeMatch) {
      const a = DAY_OFFSET[rangeMatch[1]], b = DAY_OFFSET[rangeMatch[2]];
      for (let i = a; i <= b; i++) out.push(DAY_NAMES[i]);
    } else if (DAY_OFFSET.hasOwnProperty(part)) {
      out.push(part);
    }
  }
  return out;
}
function parseWeekCell(text) {
  if (!text) return [];
  const results = [];
  for (const part of text.split('|').map(s => s.trim()).filter(Boolean)) {
    for (const sub of part.split('·').map(s => s.trim()).filter(Boolean)) {
      const mm = sub.match(/^([^\d]+?)\s*(\d+)\s*ч\.?\s*$/u);
      if (!mm) continue;
      for (const day of expandDaySpec(mm[1])) results.push({ day, hours: parseInt(mm[2], 10) });
    }
  }
  return results;
}
function parentGroup(g) {
  const mm = g.match(/^(\d+)[А-Я]$/);
  return mm ? mm[1] : g;
}
function addMinutes(hhmm, minutes) {
  const [h, mi] = hhmm.split(':').map(Number);
  const total = h * 60 + mi + minutes;
  return String(Math.floor(total / 60) % 24).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

let curNo = '', curSubject = '';
const courses = [];
const events = [];
let eventId = 0;

for (const row of rows) {
  if (row.subject) { curNo = row.no; curSubject = row.subject; }
  const no = row.no || curNo;
  const subject = row.subject || curSubject;
  const groupTokens = row.group.split('/').map(s => s.trim()).filter(Boolean);

  courses.push({ no, subject, type: row.type, teacher: row.teacher, group: row.group, groupTokens, room: row.room });

  for (const wk of WEEKS) {
    const cellText = row['w' + wk.n];
    if (!cellText) continue;
    for (const { day, hours } of parseWeekCell(cellText)) {
      const date = addDays(wk.start, DAY_OFFSET[day]);
      const start = day === 'Сб' ? row.saturday_start : row.weekday_start;
      const end = addMinutes(start, blockDurationMin(hours));
      events.push({
        id: eventId++, week: wk.n, date, day, start, end, hours,
        no, subject, type: row.type, teacher: row.teacher,
        group: row.group, groupTokens,
        groupParents: [...new Set(groupTokens.map(parentGroup))],
        room: resolveRoom(row.room, day),
      });
    }
  }
}

events.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
const allGroups = [...new Set(events.flatMap(e => e.groupTokens))].sort();

const DEFAULT_SOURCE_URL = 'https://tu-sofia.bg/api/documents/download?path=schedules%2F33NKmaZZD4fIaxF6UXfHxqwCfvh5hvhsWgNrI4m2.pdf&locale=bg';

const out = {
  meta: {
    specialty: 'МБИС', semester: 'Зимен семестър 2026/2027',
    sourceUrl: process.env.SCHEDULE_SOURCE_URL || DEFAULT_SOURCE_URL,
    generatedAt: new Date().toISOString(), academicHourMinutes: ACADEMIC_HOUR_MIN, breakMinutes: BREAK_MIN,
  },
  weeks: WEEKS, groups: allGroups, courses, events,
};

fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`Parsed ${rows.length} table rows -> ${events.length} events, ${allGroups.length} groups.`);
