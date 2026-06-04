#!/usr/bin/env node
'use strict';

/**
 * copilot-starter
 * ---------------
 * A beautiful TUI for managing GitHub Copilot CLI sessions, modeled after
 * `claude-starter`. Reads `~/.copilot` and resumes via `copilot --resume=<id>`.
 *
 * Single-file entry: arg parsing, --list mode, and the blessed TUI.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { parseArgs, HELP } = require('./lib/cli');
const { SessionStore } = require('./lib/sessions');
const {
  SORT_MODES,
  sortSessions,
  nextSortMode,
  searchSessions,
  projectsOf,
  filterByProject,
  shortenHome,
} = require('./lib/filters');
const { relTime, shortId, ellipsize, escTags, singleLine } = require('./lib/format');
const { copyToClipboard } = require('./lib/clipboard');

// ============================================================================
// Tokyo Night palette (from claude-starter)
// ============================================================================
const TN = {
  bg: '#1a1b26',
  bgAlt: '#16161e',
  bgHi: '#24283b',
  fg: '#c0caf5',
  fgDim: '#a9b1d6',
  fgMute: '#565f89',
  blue: '#7aa2f7',
  purple: '#bb9af7',
  cyan: '#7dcfff',
  green: '#9ece6a',
  yellow: '#e0af68',
  orange: '#ff9e64',
  red: '#f7768e',
  teal: '#73daca',
  border: '#3b4261',
};

const PROJECT_COLORS = [TN.blue, TN.purple, TN.cyan, TN.green, TN.yellow, TN.orange, TN.teal];

function projectColor(s) {
  const key = String(s || '');
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = ((h * 31) + key.charCodeAt(i)) >>> 0;
  return PROJECT_COLORS[h % PROJECT_COLORS.length];
}

// Pick the terminal type blessed should target.
//
// blessed has no truecolor support; it downsamples every hex color to the
// terminal's declared color count. macOS/iTerm2 sets $TERM=xterm-256color
// (256 colors), so the Tokyo Night palette renders well. On Windows Terminal
// $TERM is usually unset, and blessed's Tput falls back to the `windows-ansi`
// terminfo — which declares only 8 colors — collapsing the whole palette into
// 8 washed-out ANSI colors. Forcing `xterm-256color` (bundled with blessed and
// supported by Windows Terminal) fixes that.
//
// We force it only when we have positive evidence of a capable terminal, so we
// never "lie" to a genuinely limited terminal (TERM=linux/vt100/dumb, legacy
// consoles) and make its output worse.
function pickTerminal() {
  // Explicit escape hatch for unusual terminals.
  if (process.env.COPILOT_STARTER_TERM) return process.env.COPILOT_STARTER_TERM;

  const term = process.env.TERM || '';

  // Trust an environment that already advertises 256-color or truecolor.
  if (/(^|-)256color$/.test(term) || /direct|truecolor/i.test(term)) return undefined;

  // Windows Terminal sets WT_SESSION and natively supports xterm-256color.
  if (process.env.WT_SESSION) return 'xterm-256color';

  // On Windows with no $TERM, blessed would fall back to windows-ansi (8
  // colors). Modern Windows consoles support 256-color VT sequences.
  if (process.platform === 'win32' && !term) return 'xterm-256color';

  // Otherwise leave detection to blessed.
  return undefined;
}

// Read package version without bundling JSON.
function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ============================================================================
// Entry
// ============================================================================
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args._errors.length) {
    process.stderr.write(args._errors.map((e) => `error: ${e}`).join('\n') + '\n\n' + HELP);
    process.exit(2);
  }
  if (args.help) { process.stdout.write(HELP); process.exit(0); }
  if (args.version) { process.stdout.write(`copilot-starter v${readVersion()}\n`); process.exit(0); }

  if (args.copilotHome) process.env.COPILOT_HOME = path.resolve(args.copilotHome);

  let store;
  try {
    store = new SessionStore();
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(1);
    return;
  }

  if (args.list) {
    runList(store, args);
    store.close();
    return;
  }

  await runTui(store, args);
}

// ============================================================================
// --list mode (no TUI, plain stdout)
// ============================================================================
function runList(store, args) {
  let sessions;
  try {
    sessions = store.listSessions({ excludePatterns: args.exclude });
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(1);
    return;
  }

  if (args.search) {
    let contentIds = null;
    try { contentIds = store.searchContent(args.search); } catch { /* ignore */ }
    sessions = searchSessions(sessions, args.search, { contentIds });
  }

  sessions = sortSessions(sessions, 'updated').slice(0, args.listN);

  if (!sessions.length) {
    process.stdout.write('No sessions found.\n');
    return;
  }

  const idCol = 10;
  const projCol = 18;
  const titleCol = 50;
  const repoCol = 28;

  const header = [
    'ID'.padEnd(idCol),
    'PROJECT'.padEnd(projCol),
    'TITLE'.padEnd(titleCol),
    'REPO/BRANCH'.padEnd(repoCol),
    'MSGS'.padStart(5),
    'UPDATED'.padStart(12),
  ].join('  ');
  process.stdout.write(header + '\n');
  process.stdout.write('-'.repeat(header.length) + '\n');

  for (const s of sessions) {
    const repo = s.repository ? (s.branch ? `${s.repository}@${s.branch}` : s.repository) : '';
    const title = (s.inUse ? '[LOCKED] ' : '') + s.displayTitle;
    process.stdout.write([
      shortId(s.id).padEnd(idCol),
      ellipsize(s.project, projCol).padEnd(projCol),
      ellipsize(title, titleCol).padEnd(titleCol),
      ellipsize(repo, repoCol).padEnd(repoCol),
      String(s.messageCount).padStart(5),
      relTime(s.updatedAt).padStart(12),
    ].join('  ') + '\n');
  }
}

// ============================================================================
// TUI
// ============================================================================

/**
 * Silence blessed's noisy terminfo capability compilation errors
 * (e.g. xterm-256color.Setulc — set underline color, which blessed's
 * Tput parser doesn't understand on modern terminfo). These are
 * non-fatal: blessed falls back to a noop for the unknown cap.
 *
 * Each failure logs 4 lines via console.error: a header, the JSON
 * descriptor, a blank, and the generated source.
 */
function silenceBlessedTputErrors() {
  const HEADER_FMT = /^Error on /;
  const orig = console.error;
  let pending = 0;
  console.error = (...args) => {
    if (pending > 0) { pending -= 1; return; }
    if (typeof args[0] === 'string' && HEADER_FMT.test(args[0])) {
      pending = 3;
      return;
    }
    return orig.apply(console, args);
  };
}

async function runTui(store, args) {
  silenceBlessedTputErrors();
  const blessed = require('blessed');

  // ----- State -----
  const state = {
    raw: [],            // unfiltered sessions
    view: [],           // sorted+filtered view
    selectedIdx: 0,     // index in `view` (offset by 1 for "+ New Session" row)
    query: '',          // current search query
    projectFilter: null,// {cwd, label} or null
    sortMode: 'updated',
    mode: 'list',       // list | search | rename | project | confirm
    pendingDelete: null,
    pendingRename: null,
    statusMsg: '',
    statusUntil: 0,
  };

  function flash(msg, ms = 2500) {
    state.statusMsg = msg;
    state.statusUntil = Date.now() + ms;
    renderStatus();
    setTimeout(renderStatus, ms + 50);
  }

  function reload() {
    try {
      state.raw = store.listSessions({ excludePatterns: args.exclude });
    } catch (e) {
      state.raw = [];
      flash(`error: ${e.message}`);
    }
    rebuildView({ keepSelection: true });
  }

  function rebuildView({ keepSelection = false } = {}) {
    const prev = keepSelection ? currentSession() : null;
    let v = state.raw;
    if (state.projectFilter) v = filterByProject(v, state.projectFilter.cwd);
    if (state.query) {
      let contentIds = null;
      try { contentIds = store.searchContent(state.query); } catch { contentIds = null; }
      v = searchSessions(v, state.query, { contentIds });
    }
    v = sortSessions(v, state.sortMode);
    state.view = v;
    if (prev) {
      const i = v.findIndex((s) => s.id === prev.id);
      state.selectedIdx = i >= 0 ? i + 1 : 0;
    } else {
      state.selectedIdx = 0;
    }
    clampSelection();
    renderList();
    renderPreview();
    renderHeader();
    renderStatus();
  }

  function clampSelection() {
    const max = state.view.length; // +1 for "New Session" row at index 0
    if (state.selectedIdx < 0) state.selectedIdx = 0;
    if (state.selectedIdx > max) state.selectedIdx = max;
  }

  function currentSession() {
    if (state.selectedIdx === 0) return null;
    return state.view[state.selectedIdx - 1] || null;
  }

  // ----- UI primitives -----
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: 'copilot-starter',
    autoPadding: false,
    warnings: false,
    terminal: pickTerminal(),
  });

  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    tags: true,
    style: { fg: TN.fg, bg: TN.bgAlt },
  });

  const list = blessed.list({
    parent: screen,
    label: ' Sessions ',
    top: 1,
    left: 0,
    width: '50%',
    bottom: 2,
    border: { type: 'line' },
    tags: true,
    keys: false,
    mouse: false,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ', style: { bg: TN.bgHi } },
    style: {
      fg: TN.fg,
      bg: TN.bg,
      border: { fg: TN.border },
      label: { fg: TN.cyan },
      selected: { bg: TN.bgHi, fg: TN.fg, bold: true },
      item: { fg: TN.fg, bg: TN.bg },
    },
    items: [],
  });

  const preview = blessed.box({
    parent: screen,
    label: ' Preview ',
    top: 1,
    left: '50%',
    right: 0,
    bottom: 2,
    border: { type: 'line' },
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: false,
    mouse: false,
    scrollbar: { ch: ' ', style: { bg: TN.bgHi } },
    style: {
      fg: TN.fg,
      bg: TN.bg,
      border: { fg: TN.border },
      label: { fg: TN.purple },
    },
    content: '',
  });

  const status = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    tags: true,
    style: { fg: TN.fgDim, bg: TN.bgAlt },
  });

  // Search bar (hidden until activated)
  const searchBar = blessed.box({
    parent: screen,
    bottom: 2,
    left: 0,
    right: 0,
    height: 1,
    tags: true,
    hidden: true,
    style: { fg: TN.fg, bg: TN.bgHi },
  });

  // Modal layer for popups
  const modalBg = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    hidden: true,
    style: { bg: TN.bg },
    transparent: false,
  });

  // ----- Render functions -----
  function renderHeader() {
    const total = state.raw.length;
    const shown = state.view.length;
    const sortLabel = SORT_MODES.find((m) => m.id === state.sortMode)?.label || state.sortMode;
    const filterParts = [];
    if (state.projectFilter) filterParts.push(`proj:${state.projectFilter.label}`);
    if (state.query) filterParts.push(`q:"${state.query}"`);
    const filterTxt = filterParts.length ? `  ${filterParts.join('  ')}` : '';
    const left = ` {${TN.cyan}-fg}{bold}copilot-starter{/bold}{/} v${readVersion()}  ` +
      `{${TN.fgDim}-fg}sessions:{/} {${TN.green}-fg}${shown}{/}/{${TN.fgDim}-fg}${total}{/}  ` +
      `{${TN.fgDim}-fg}sort:{/} {${TN.yellow}-fg}${sortLabel}{/}${escTags(filterTxt)}`;
    header.setContent(left);
    screen.render();
  }

  function renderList() {
    const items = [];
    items.push(`{${TN.green}-fg}{bold}+ New Session{/bold}{/}  {${TN.fgDim}-fg}— start a fresh copilot session{/}`);

    for (const s of state.view) {
      items.push(formatListRow(s));
    }
    list.setItems(items);
    list.select(state.selectedIdx);
    screen.render();
  }

  function formatListRow(s) {
    const color = projectColor(s.cwd || s.project);
    const projBadge = `{${color}-fg}●{/} {${color}-fg}${escTags(ellipsize(s.project, 18))}{/}`;
    const lockTag = s.inUse ? `{${TN.red}-fg}[LOCKED]{/} ` : '';
    const userTag = s.userNamed ? `{${TN.purple}-fg}✎{/} ` : '';
    const title = `{bold}${escTags(ellipsize(s.displayTitle || '(untitled)', 50))}{/bold}`;
    const repo = s.repository
      ? `{${TN.fgDim}-fg}${escTags(ellipsize(s.repository, 28))}{/}${s.branch ? ` {${TN.fgMute}-fg}@${escTags(ellipsize(s.branch, 18))}{/}` : ''}`
      : `{${TN.fgMute}-fg}—{/}`;
    const counts = `{${TN.cyan}-fg}${s.messageCount}{/}{${TN.fgMute}-fg}msg{/}`;
    const time = `{${TN.fgDim}-fg}${escTags(relTime(s.updatedAt))}{/}`;
    return `${projBadge}  ${lockTag}${userTag}${title}  ${repo}  ${counts}  ${time}`;
  }

  function renderPreview() {
    const s = currentSession();
    if (!s) {
      preview.setContent(
        `\n  {${TN.green}-fg}+ New Session{/}\n\n` +
        `  Press {bold}Enter{/bold} or {bold}n{/bold} to launch a fresh\n` +
        `  Copilot CLI session in the current directory.\n\n` +
        `  {${TN.fgDim}-fg}cwd: ${escTags(process.cwd())}{/}\n`
      );
      screen.render();
      return;
    }

    const lines = [];
    const color = projectColor(s.cwd || s.project);

    // Title block
    lines.push('');
    lines.push(`  {${color}-fg}{bold}${escTags(s.displayTitle || '(untitled)')}{/bold}{/}`);
    lines.push(`  {${TN.fgDim}-fg}${escTags(s.id)}{/}${s.inUse ? `   {${TN.red}-fg}● LIVE{/}` : ''}${s.hasStaleLock ? `   {${TN.yellow}-fg}stale lock{/}` : ''}`);
    lines.push('');

    const meta = [
      ['cwd', shortenHome(s.cwd) || '—'],
      ['project', s.project],
      ['repo', s.repository ? `${s.repository}${s.branch ? `@${s.branch}` : ''}` : '—'],
      ['host', s.hostType || '—'],
      ['created', s.createdAt ? `${s.createdAt} (${relTime(s.createdAt)})` : '—'],
      ['updated', s.updatedAt ? `${s.updatedAt} (${relTime(s.updatedAt)})` : '—'],
      ['messages', String(s.messageCount)],
      ['checkpoints', String(s.checkpointCount)],
      ['files', String(s.fileCount)],
      ['refs', String(s.refCount)],
    ];
    for (const [k, v] of meta) {
      lines.push(`  {${TN.fgMute}-fg}${k.padEnd(11)}{/} {${TN.fg}-fg}${escTags(String(v))}{/}`);
    }

    // Generated summary block
    if (s.dbSummary && s.dbSummary !== s.displayTitle) {
      lines.push('');
      lines.push(`  {${TN.purple}-fg}{bold}Generated summary{/bold}{/}`);
      lines.push(`  {${TN.fgDim}-fg}${escTags(singleLine(s.dbSummary, 240))}{/}`);
    }

    // Recent turns
    let turns = [];
    try { turns = store.recentTurns(s.id, 5); } catch { turns = []; }
    if (turns.length) {
      lines.push('');
      lines.push(`  {${TN.cyan}-fg}{bold}Recent turns{/bold}{/}`);
      for (const t of turns) {
        const u = singleLine(t.userMessage || '', 200);
        const a = singleLine(t.assistantResponse || '', 200);
        if (u) lines.push(`  {${TN.green}-fg}▸ user{/} ${escTags(u)}`);
        if (a) lines.push(`  {${TN.blue}-fg}▸ assistant{/} {${TN.fgDim}-fg}${escTags(a)}{/}`);
      }
    }

    // Files
    let files = [];
    try { files = store.files(s.id); } catch { files = []; }
    if (files.length) {
      lines.push('');
      lines.push(`  {${TN.yellow}-fg}{bold}Touched files{/bold}{/} {${TN.fgMute}-fg}(${files.length}){/}`);
      const seen = new Set();
      const uniq = files.filter((f) => (seen.has(f.filePath) ? false : (seen.add(f.filePath), true)));
      for (const f of uniq.slice(0, 12)) {
        lines.push(`  {${TN.fgDim}-fg}•{/} ${escTags(shortenHome(f.filePath))} {${TN.fgMute}-fg}(${f.toolName || '?'}){/}`);
      }
      if (uniq.length > 12) {
        lines.push(`  {${TN.fgMute}-fg}…and ${uniq.length - 12} more{/}`);
      }
    }

    // Refs
    let refs = [];
    try { refs = store.refs(s.id); } catch { refs = []; }
    if (refs.length) {
      lines.push('');
      lines.push(`  {${TN.orange}-fg}{bold}Refs{/bold}{/}`);
      for (const r of refs.slice(0, 8)) {
        lines.push(`  {${TN.fgDim}-fg}•{/} ${escTags(r.refType || '?')}: {${TN.cyan}-fg}${escTags(r.refValue || '')}{/}`);
      }
    }

    preview.setContent(lines.join('\n'));
    preview.setScrollPerc(0);
    screen.render();
  }

  function renderStatus() {
    const now = Date.now();
    if (now < state.statusUntil && state.statusMsg) {
      status.setContent(` {${TN.yellow}-fg}${escTags(state.statusMsg)}{/}\n` + statusKeyHints());
    } else {
      status.setContent(` {${TN.fgDim}-fg}${escTags(modeBanner())}{/}\n` + statusKeyHints());
    }
    screen.render();
  }

  function modeBanner() {
    if (state.mode === 'search') return `Search: ${state.query}_   (Esc to clear, Enter to keep)`;
    if (state.mode === 'rename') return `Rename: ${state.pendingRename?.value || ''}_   (Esc to cancel, Enter to save)`;
    if (state.mode === 'project') return 'Project filter — ↑↓ to choose, Enter to apply, Esc to cancel';
    if (state.mode === 'confirm') return `Delete "${state.pendingDelete?.displayTitle || ''}"? (y/N)`;
    return 'Ready';
  }

  function statusKeyHints() {
    return ` {${TN.fgMute}-fg}` +
      `↑↓/jk nav • Enter resume • n new • / search • p project • s sort • r rename • c copy id • x delete • q quit` +
      `{/}`;
  }

  // ----- Search bar rendering -----
  function showSearchBar() {
    searchBar.show();
    renderSearchBar();
  }
  function hideSearchBar() { searchBar.hide(); screen.render(); }
  function renderSearchBar() {
    searchBar.setContent(` {${TN.cyan}-fg}/{/} ${escTags(state.query)}{${TN.fgMute}-fg}_{/}   {${TN.fgMute}-fg}(Esc to clear, Enter to keep, Backspace to edit){/}`);
    screen.render();
  }

  // ----- Modes -----
  function enterSearchMode() {
    state.mode = 'search';
    showSearchBar();
    renderStatus();
  }
  function exitSearchMode({ keepQuery = true } = {}) {
    state.mode = 'list';
    if (!keepQuery) {
      state.query = '';
      rebuildView({ keepSelection: true });
    }
    hideSearchBar();
    renderStatus();
  }
  function searchTypeChar(ch) {
    state.query += ch;
    rebuildView({ keepSelection: false });
    renderSearchBar();
  }
  function searchBackspace() {
    if (!state.query) {
      exitSearchMode({ keepQuery: false });
      return;
    }
    state.query = state.query.slice(0, -1);
    rebuildView({ keepSelection: false });
    renderSearchBar();
  }

  // Rename
  function enterRenameMode() {
    const s = currentSession();
    if (!s) { flash('Select a session to rename.'); return; }
    if (s.inUse) { flash('Session is in use; cannot rename.'); return; }
    state.mode = 'rename';
    state.pendingRename = { id: s.id, value: s.displayTitle || '' };
    showRenamePrompt();
  }
  function showRenamePrompt() {
    searchBar.show();
    searchBar.setContent(` {${TN.purple}-fg}rename{/} ${escTags(state.pendingRename.value)}{${TN.fgMute}-fg}_{/}   {${TN.fgMute}-fg}(Esc cancel, Enter save){/}`);
    screen.render();
  }
  function renameTypeChar(ch) {
    state.pendingRename.value += ch;
    showRenamePrompt();
  }
  function renameBackspace() {
    state.pendingRename.value = state.pendingRename.value.slice(0, -1);
    showRenamePrompt();
  }
  function renameCommit() {
    const id = state.pendingRename.id;
    const newName = state.pendingRename.value.trim();
    if (!newName) { flash('Name cannot be empty.'); return; }
    try {
      store.rename(id, newName);
      flash(`Renamed → ${newName}`);
    } catch (e) {
      flash(`rename failed: ${e.message}`);
    }
    cancelRename();
    reload();
  }
  function cancelRename() {
    state.mode = 'list';
    state.pendingRename = null;
    hideSearchBar();
    renderStatus();
  }

  // Confirm delete
  function enterConfirmDelete() {
    const s = currentSession();
    if (!s) { flash('Select a session to delete.'); return; }
    if (s.inUse) { flash('Session is in use; cannot delete.'); return; }
    state.mode = 'confirm';
    state.pendingDelete = s;
    renderStatus();
  }
  function commitDelete() {
    const s = state.pendingDelete;
    if (!s) return cancelConfirm();
    try {
      const r = store.delete(s.id);
      flash(`Deleted ${shortId(s.id)} (${r.rowsDeleted} rows, dir=${r.dirRemoved})`);
    } catch (e) {
      flash(`delete failed: ${e.message}`);
    }
    cancelConfirm();
    reload();
  }
  function cancelConfirm() {
    state.mode = 'list';
    state.pendingDelete = null;
    renderStatus();
  }

  // Project filter popup
  let projectListBox = null;
  function enterProjectMode() {
    state.mode = 'project';
    const projects = projectsOf(state.raw);
    const items = [`{${TN.fgDim}-fg}(all projects){/}`];
    for (const p of projects) {
      const color = projectColor(p.cwd);
      items.push(`{${color}-fg}●{/} ${escTags(p.label)}  {${TN.fgMute}-fg}(${p.count}){/}`);
    }
    projectListBox = blessed.list({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height: Math.min(projects.length + 4, Math.floor(screen.height * 0.7)),
      border: { type: 'line' },
      label: ' Filter by project ',
      tags: true,
      keys: false,
      mouse: false,
      scrollable: true,
      style: {
        fg: TN.fg,
        bg: TN.bgAlt,
        border: { fg: TN.purple },
        label: { fg: TN.purple },
        selected: { bg: TN.bgHi, fg: TN.fg, bold: true },
        item: { fg: TN.fg, bg: TN.bgAlt },
      },
      items,
    });
    projectListBox._projects = projects;
    projectListBox.select(state.projectFilter ? Math.max(0, projects.findIndex((p) => p.cwd === state.projectFilter.cwd) + 1) : 0);
    projectListBox.setFront();
    renderStatus();
    screen.render();
  }
  function projectMove(delta) {
    if (!projectListBox) return;
    const cur = projectListBox.selected;
    const max = projectListBox.items.length - 1;
    let next = cur + delta;
    if (next < 0) next = 0;
    if (next > max) next = max;
    projectListBox.select(next);
    screen.render();
  }
  function projectCommit() {
    if (!projectListBox) return;
    const idx = projectListBox.selected;
    const projects = projectListBox._projects;
    if (idx === 0) state.projectFilter = null;
    else state.projectFilter = projects[idx - 1] || null;
    cancelProjectMode();
    rebuildView({ keepSelection: true });
  }
  function cancelProjectMode() {
    if (projectListBox) {
      projectListBox.detach();
      projectListBox = null;
    }
    state.mode = 'list';
    renderStatus();
    screen.render();
  }

  // ----- Navigation -----
  function moveSelection(delta) {
    state.selectedIdx += delta;
    clampSelection();
    list.select(state.selectedIdx);
    renderPreview();
    screen.render();
  }
  function jumpTop() { state.selectedIdx = 0; list.select(0); renderPreview(); screen.render(); }
  function jumpBottom() { state.selectedIdx = state.view.length; list.select(state.selectedIdx); renderPreview(); screen.render(); }
  function pageDown() { moveSelection(Math.max(1, Math.floor(list.height / 2))); }
  function pageUp() { moveSelection(-Math.max(1, Math.floor(list.height / 2))); }

  // ----- Spawn copilot (resume / new) -----
  function spawnCopilot({ id = null, cwd = null } = {}) {
    const args2 = [];
    if (id) args2.push('--resume', id);
    const opts = { stdio: 'inherit', shell: false };
    if (cwd && fs.existsSync(cwd)) opts.cwd = cwd;
    let child;
    try {
      // Tear down TUI first so child owns the TTY.
      screen.destroy();
      store.close();
    } catch { /* noop */ }
    try {
      child = spawn('copilot', args2, opts);
    } catch (e) {
      process.stderr.write(`error: failed to spawn copilot: ${e.message}\n`);
      process.exit(1);
      return;
    }
    child.on('error', (e) => {
      process.stderr.write(`error: copilot failed: ${e.message}\n`);
      if (e.code === 'ENOENT') {
        process.stderr.write('Is the GitHub Copilot CLI installed and on $PATH?\n');
      }
      process.exit(1);
    });
    child.on('exit', (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      else process.exit(code ?? 0);
    });
  }

  // ----- Copy id -----
  async function copyCurrentId() {
    const s = currentSession();
    if (!s) { flash('Select a session first.'); return; }
    const r = await copyToClipboard(s.id);
    if (r.ok) flash(`Copied ${shortId(s.id)} via ${r.tool}`);
    else flash(`Could not find a clipboard tool. ID: ${s.id}`);
  }

  // ----- Key dispatch -----
  // We handle keys at the screen level so we can route by mode.
  screen.on('keypress', (ch, key) => {
    // Modal modes intercept first.
    if (state.mode === 'project') {
      if (key.name === 'escape') return cancelProjectMode();
      if (key.name === 'return' || key.name === 'enter') return projectCommit();
      if (key.name === 'down' || ch === 'j') return projectMove(1);
      if (key.name === 'up' || ch === 'k') return projectMove(-1);
      if (key.name === 'pagedown') return projectMove(5);
      if (key.name === 'pageup') return projectMove(-5);
      if (key.name === 'home' || ch === 'g') return projectMove(-9999);
      if (key.name === 'end' || ch === 'G') return projectMove(9999);
      return;
    }

    if (state.mode === 'confirm') {
      if (ch === 'y' || ch === 'Y') return commitDelete();
      if (ch === 'n' || ch === 'N' || key.name === 'escape') return cancelConfirm();
      return;
    }

    if (state.mode === 'rename') {
      if (key.name === 'escape') return cancelRename();
      if (key.name === 'return' || key.name === 'enter') return renameCommit();
      if (key.name === 'backspace') return renameBackspace();
      if (ch && !key.ctrl && !key.meta && ch.length === 1 && ch >= ' ') return renameTypeChar(ch);
      return;
    }

    if (state.mode === 'search') {
      if (key.name === 'escape') return exitSearchMode({ keepQuery: false });
      if (key.name === 'return' || key.name === 'enter') return exitSearchMode({ keepQuery: true });
      if (key.name === 'backspace') return searchBackspace();
      if (key.name === 'down' || key.name === 'up' || key.name === 'pagedown' || key.name === 'pageup') {
        // Allow nav while searching
      } else if (ch && !key.ctrl && !key.meta && ch.length === 1 && ch >= ' ') {
        return searchTypeChar(ch);
      }
    }

    // List mode + (search w/ nav passthrough)
    if (key.full === 'C-c' || (state.mode === 'list' && (ch === 'q' || key.name === 'q'))) {
      cleanShutdown(0);
      return;
    }
    if (key.name === 'down' || ch === 'j') return moveSelection(1);
    if (key.name === 'up' || ch === 'k') return moveSelection(-1);
    if (key.full === 'C-d') return pageDown();
    if (key.full === 'C-u') return pageUp();
    if (ch === 'g') return jumpTop();
    if (ch === 'G') return jumpBottom();
    if (key.name === 'home') return jumpTop();
    if (key.name === 'end') return jumpBottom();
    if (key.name === 'pagedown') return pageDown();
    if (key.name === 'pageup') return pageUp();

    if (state.mode !== 'list') return;

    if (key.name === 'enter' || key.name === 'return') {
      const s = currentSession();
      if (s) {
        if (s.inUse) { flash('Session is in use by another copilot process.'); return; }
        spawnCopilot({ id: s.id, cwd: s.cwd });
      } else {
        spawnCopilot({});
      }
      return;
    }
    if (ch === 'n') return spawnCopilot({});
    if (ch === '/') return enterSearchMode();
    if (ch === 'p') return enterProjectMode();
    if (ch === 's') {
      state.sortMode = nextSortMode(state.sortMode);
      rebuildView({ keepSelection: true });
      flash(`Sort: ${state.sortMode}`);
      return;
    }
    if (ch === 'r') return enterRenameMode();
    if (ch === 'c') { copyCurrentId(); return; }
    if (ch === 'x' || key.name === 'delete') return enterConfirmDelete();
    if (key.name === 'escape') {
      // Esc in list mode clears query/filter
      if (state.query || state.projectFilter) {
        state.query = '';
        state.projectFilter = null;
        rebuildView({ keepSelection: true });
        flash('Cleared filters.');
      }
      return;
    }
  });

  function cleanShutdown(code) {
    try { screen.destroy(); } catch { /* noop */ }
    try { store.close(); } catch { /* noop */ }
    process.exit(code);
  }

  // Initial render + load
  reload();
  screen.render();
}

// ============================================================================
main().catch((e) => {
  process.stderr.write(`fatal: ${e?.stack || e}\n`);
  process.exit(1);
});
