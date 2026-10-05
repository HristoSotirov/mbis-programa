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

// Plain reading-order text, used to pick up the "room change" footnotes
// printed below the table (e.g. "* Лекции в понеделник: зала 3401; в
// останалите дни: 3501."). We resolve these into a concrete room per
// weekday instead of showing the raw "3401/3501*" to the user.
const plainText = execFileSync('pdftotext', [pdfPath, '-']).toString('utf8');
const DAY_NAME_BG = { 'понеделник': 'Пн', 'вторник': 'Вт', 'сряда': 'Ср', 'четвъртък': 'Чт', 'петък': 'Пт', 'събота': 'Сб' };
const roomRules = {}; // asterisk-count -> { specialDay, specialRoom, otherRoom }
{
  const footnoteRe = /(\*{1,4})\s*(?:Лекции|Лаб\.\s*упражнения)\s+(?:в|във)\s+(понеделник|вторник|сряда|четвъртък|петък|събота)[:\s]+(?:зала\s*)?([^\s;]+)\s*;\s*в\s+останалите\s+дни:\s*([^\s.]+)\.?/giu;
  let fm;
  while ((fm = footnoteRe.exec(plainText))) {
    roomRules[fm[1].length] = { specialDay: DAY_NAME_BG[fm[2]], specialRoom: fm[3], otherRoom: fm[4] };
  }
}
function resolveRoom(rawRoom, day) {
  if (!rawRoom) return rawRoom;
  const starMatch = rawRoom.match(/(\*{1,4})\s*$/);
  if (!starMatch) return rawRoom;
  const rule = roomRules[starMatch[1].length];
  const base = rawRoom.slice(0, starMatch.index).trim();
  if (!rule) return base; // unknown footnote marker — at least drop the stray asterisks
  const tokens = base.split('/').map(s => s.trim());
  if (!tokens.includes(rule.specialRoom) || !tokens.includes(rule.otherRoom)) return base;
  return day === rule.specialDay ? rule.specialRoom : rule.otherRoom;
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
// Column boundaries were calibrated against the rendered PDF (see
// docs/parsing-notes.md): header label x-positions sit ~27-28pt right of
// the true grid line for the week columns, so week boundaries are derived
// from the observed uniform 118.375pt column pitch instead of the header
// text position.

const weekBase = 1161.9, weekStep = 118.375; // boundary between week3/week4, and column pitch
const weekLeft = {};
for (let n = 1; n <= 13; n++) weekLeft['w' + n] = weekBase + (n - 4) * weekStep;
const weekEnd = weekBase + 10 * weekStep;

const colStarts = [
  ['no', 36], ['subject', 70], ['type', 140], ['teacher', 199],
  ['group', 365], ['room', 497], ['weekday_start', 626], ['saturday_start', 720.6],
  ...Array.from({ length: 13 }, (_, i) => [`w${i + 1}`, weekLeft[`w${i + 1}`]]),
  ['__end', weekEnd],
];
const metaCols = ['no', 'subject', 'type', 'teacher', 'group', 'room', 'weekday_start', 'saturday_start'];

function colOf(x) {
  for (let i = 0; i < colStarts.length - 1; i++) {
    if (x >= colStarts[i][1] && x < colStarts[i + 1][1]) return colStarts[i][0];
  }
  return '__end';
}

const body = words.filter(w => w.y0 > 170 && w.y0 < 1551);

const anchorWords = body.filter(w => colOf(w.x0) === 'weekday_start').sort((a, b) => a.y0 - b.y0);
if (anchorWords.length < 10) {
  throw new Error(`Only found ${anchorWords.length} table rows — PDF layout may have changed, parser needs review.`);
}

const rowBands = anchorWords.map((a, i) => {
  const prev = anchorWords[i - 1], next = anchorWords[i + 1];
  const top = prev ? (prev.y0 + a.y0) / 2 : a.y0 - 20;
  const bottom = next ? (a.y0 + next.y0) / 2 : a.y0 + 20;
  return { y0: a.y0, top, bottom, meta: {}, weekWords: [] };
});
function bandFor(y0) { return rowBands.find(r => y0 >= r.top && y0 < r.bottom); }

for (const w of body) {
  const col = colOf(w.x0);
  if (!metaCols.includes(col)) continue;
  const band = bandFor(w.y0);
  if (!band) continue;
  (band.meta[col] = band.meta[col] || []).push(w);
}
for (const band of rowBands) {
  for (const col of metaCols) {
    const ws = (band.meta[col] || []).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    band.meta[col] = ws.map(w => w.text).join(' ');
  }
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

const rows = rowBands.map(band => {
  const rec = {};
  for (const c of metaCols) rec[c] = band.meta[c] || '';
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

function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function expandDaySpec(spec) {
  spec = spec.trim();
  const rangeMatch = spec.match(/^(Пн|Вт|Ср|Чт|Пт|Сб)\s*[–-]\s*(Пн|Вт|Ср|Чт|Пт|Сб)$/);
  if (rangeMatch) {
    const a = DAY_OFFSET[rangeMatch[1]], b = DAY_OFFSET[rangeMatch[2]];
    const out = [];
    for (let i = a; i <= b; i++) out.push(DAY_NAMES[i]);
    return out;
  }
  if (spec.includes(',') || spec.includes('/')) {
    return spec.split(/[,/]/).map(s => s.trim()).filter(Boolean);
  }
  if (DAY_OFFSET.hasOwnProperty(spec)) return [spec];
  return [];
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
  const mm = g.match(/^(\d+)[АБ]$/);
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
      const end = addMinutes(start, hours * ACADEMIC_HOUR_MIN);
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
    generatedAt: new Date().toISOString(), academicHourMinutes: ACADEMIC_HOUR_MIN,
  },
  weeks: WEEKS, groups: allGroups, courses, events,
};

fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`Parsed ${rows.length} table rows -> ${events.length} events, ${allGroups.length} groups.`);
