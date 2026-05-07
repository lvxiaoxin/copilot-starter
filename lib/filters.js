'use strict';

/**
 * filters.js
 * ----------
 * Sort, filter, and search helpers operating on the normalized session
 * objects produced by sessions.js. Pure functions — no I/O.
 */

const SORT_MODES = [
  { id: 'updated', label: 'updated', cmp: (a, b) => cmpDateDesc(a.updatedAt, b.updatedAt) },
  { id: 'messages', label: 'messages', cmp: (a, b) => cmpNumDesc(a.messageCount, b.messageCount) || cmpDateDesc(a.updatedAt, b.updatedAt) },
  { id: 'checkpoints', label: 'checkpoints', cmp: (a, b) => cmpNumDesc(a.checkpointCount, b.checkpointCount) || cmpDateDesc(a.updatedAt, b.updatedAt) },
  { id: 'files', label: 'files', cmp: (a, b) => cmpNumDesc(a.fileCount, b.fileCount) || cmpDateDesc(a.updatedAt, b.updatedAt) },
  { id: 'project', label: 'project', cmp: (a, b) => cmpStrAsc(a.project, b.project) || cmpDateDesc(a.updatedAt, b.updatedAt) },
  { id: 'name', label: 'name', cmp: (a, b) => cmpStrAsc(a.displayTitle, b.displayTitle) || cmpDateDesc(a.updatedAt, b.updatedAt) },
];

function cmpStrAsc(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}
function cmpNumDesc(a, b) {
  return (b || 0) - (a || 0);
}
function cmpDateDesc(a, b) {
  return String(b || '').localeCompare(String(a || ''));
}

function sortSessions(sessions, modeId) {
  const mode = SORT_MODES.find((m) => m.id === modeId) || SORT_MODES[0];
  return [...sessions].sort(mode.cmp);
}

function nextSortMode(modeId) {
  const idx = SORT_MODES.findIndex((m) => m.id === modeId);
  return SORT_MODES[(idx + 1) % SORT_MODES.length].id;
}

function searchSessions(sessions, query, { contentIds = null } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q && !contentIds) return sessions;
  const tokens = q.split(/\s+/).filter(Boolean);
  const idSet = contentIds ? new Set(contentIds) : null;
  return sessions.filter((s) => {
    if (idSet && idSet.has(s.id)) return true;
    if (!tokens.length) return false;
    const hay = (
      (s.displayTitle || '') + ' ' +
      (s.summary || '') + ' ' +
      (s.project || '') + ' ' +
      (s.cwd || '') + ' ' +
      (s.repository || '') + ' ' +
      (s.branch || '') + ' ' +
      (s.id || '')
    ).toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

/**
 * Returns a list of { cwd, label, count } for project filtering.
 * Disambiguates basenames that occur in multiple cwds.
 */
function projectsOf(sessions) {
  const byCwd = new Map();
  for (const s of sessions) {
    const cwd = s.cwd || '(no cwd)';
    if (!byCwd.has(cwd)) byCwd.set(cwd, { cwd, base: s.project, count: 0 });
    byCwd.get(cwd).count += 1;
  }
  // Detect basename collisions
  const baseCounts = new Map();
  for (const v of byCwd.values()) baseCounts.set(v.base, (baseCounts.get(v.base) || 0) + 1);
  const out = [];
  for (const v of byCwd.values()) {
    const collides = (baseCounts.get(v.base) || 0) > 1;
    out.push({
      cwd: v.cwd,
      label: collides ? `${v.base} — ${shortenHome(v.cwd)}` : v.base,
      count: v.count,
    });
  }
  out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return out;
}

function shortenHome(p) {
  const home = require('os').homedir();
  if (p && p.startsWith(home)) return '~' + p.slice(home.length);
  return p || '';
}

function filterByProject(sessions, cwd) {
  if (!cwd) return sessions;
  return sessions.filter((s) => (s.cwd || '(no cwd)') === cwd);
}

module.exports = {
  SORT_MODES,
  sortSessions,
  nextSortMode,
  searchSessions,
  projectsOf,
  filterByProject,
  shortenHome,
};
