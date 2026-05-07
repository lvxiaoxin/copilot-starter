'use strict';

/**
 * sessions.js
 * -----------
 * The data layer. Reads sessions from Copilot CLI's storage and merges them
 * into a single normalized session object suitable for the TUI/list mode.
 *
 * - `~/.copilot/session-store.db` (SQLite, may be opened by Copilot at the
 *   same time — we open read-only by default).
 * - `~/.copilot/session-state/<id>/workspace.yaml` — name, cwd, summary.
 * - `~/.copilot/session-state/<id>/events.jsonl` — only stat'd for size.
 * - `~/.copilot/session-state/<id>/inuse.<pid>.lock` — in-use detection.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { paths } = require('./paths');
const { readWorkspace, updateWorkspaceName } = require('./workspace');
const { isInUse, listStaleLocks } = require('./locks');

const REQUIRED_TABLES = ['sessions', 'turns'];
const OPTIONAL_TABLES = ['checkpoints', 'session_files', 'session_refs', 'search_index'];

function isUuidLike(s) {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Convert an arbitrary user query into an FTS5-safe expression. Tokens
 * separated by whitespace become AND-combined, each wrapped in a quoted
 * phrase so special characters (-, :, ", *) don't trigger FTS5 operators.
 */
function ftsQuote(q) {
  if (!q) return '';
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.length) return '';
  return tokens
    .map((t) => '"' + t.replace(/"/g, '""') + '"')
    .join(' AND ');
}

class SessionStore {
  constructor({ home } = {}) {
    this.paths = paths(home);
    this._readDb = null;
    this._writeDb = null;
    this._tables = null;
  }

  // -------- Connection management --------

  _openRead() {
    if (this._readDb) return this._readDb;
    if (!fs.existsSync(this.paths.sessionStoreDb)) {
      const err = new Error(`Copilot session DB not found at ${this.paths.sessionStoreDb}. Is the Copilot CLI installed and have you run it at least once?`);
      err.code = 'COPILOT_DB_MISSING';
      throw err;
    }
    this._readDb = new Database(this.paths.sessionStoreDb, {
      readonly: true,
      fileMustExist: true,
    });
    // Read-only connections cannot mutate journal mode; busy_timeout still
    // helps if SQLite needs to wait for a checkpoint.
    try { this._readDb.pragma('busy_timeout = 3000'); } catch { /* noop */ }
    return this._readDb;
  }

  _openWrite() {
    if (this._writeDb) return this._writeDb;
    this._writeDb = new Database(this.paths.sessionStoreDb, {
      readonly: false,
      fileMustExist: true,
    });
    try { this._writeDb.pragma('busy_timeout = 5000'); } catch { /* noop */ }
    // Do NOT change journal_mode — Copilot owns the DB.
    return this._writeDb;
  }

  close() {
    if (this._readDb) { try { this._readDb.close(); } catch { /* noop */ } this._readDb = null; }
    if (this._writeDb) { try { this._writeDb.close(); } catch { /* noop */ } this._writeDb = null; }
  }

  // -------- Schema probing --------

  tables() {
    if (this._tables) return this._tables;
    const db = this._openRead();
    const rows = db.prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table','view') OR (type='table' AND name LIKE 'sqlite_%')"
    ).all();
    const present = new Set(rows.map((r) => r.name));
    for (const t of REQUIRED_TABLES) {
      if (!present.has(t)) {
        const err = new Error(`Required table '${t}' missing from ${this.paths.sessionStoreDb}. The Copilot CLI database schema may have changed; please update copilot-starter.`);
        err.code = 'COPILOT_DB_SCHEMA';
        throw err;
      }
    }
    const optional = {};
    for (const t of OPTIONAL_TABLES) optional[t] = present.has(t);
    this._tables = { present, optional };
    return this._tables;
  }

  // -------- Reads --------

  /**
   * Returns a list of normalized session objects, newest first.
   * Each object:
   *   { id, cwd, project, displayTitle, name, summary, dbSummary,
   *     userNamed, repository, branch, hostType,
   *     createdAt, updatedAt, messageCount, checkpointCount, fileCount,
   *     refCount, sizeBytes, inUse, hasStaleLock, hasState }
   */
  listSessions({ excludePatterns = [] } = {}) {
    const db = this._openRead();
    const tbl = this.tables();

    const baseRows = db.prepare(`
      SELECT s.id, s.cwd, s.repository, s.host_type AS hostType, s.branch,
             s.summary AS dbSummary, s.created_at AS createdAt, s.updated_at AS updatedAt,
             COALESCE(t.cnt, 0) AS messageCount
      FROM sessions s
      LEFT JOIN (
        SELECT session_id, COUNT(*) AS cnt FROM turns GROUP BY session_id
      ) t ON t.session_id = s.id
      ORDER BY s.updated_at DESC
    `).all();

    const cpCounts = tbl.optional.checkpoints
      ? new Map(db.prepare('SELECT session_id, COUNT(*) AS cnt FROM checkpoints GROUP BY session_id').all().map((r) => [r.session_id, r.cnt]))
      : new Map();
    const fileCounts = tbl.optional.session_files
      ? new Map(db.prepare('SELECT session_id, COUNT(*) AS cnt FROM session_files GROUP BY session_id').all().map((r) => [r.session_id, r.cnt]))
      : new Map();
    const refCounts = tbl.optional.session_refs
      ? new Map(db.prepare('SELECT session_id, COUNT(*) AS cnt FROM session_refs GROUP BY session_id').all().map((r) => [r.session_id, r.cnt]))
      : new Map();

    const out = [];
    for (const row of baseRows) {
      const sessionDir = this.paths.sessionDir(row.id);
      const hasState = fs.existsSync(sessionDir);
      let ws = null;
      if (hasState) {
        try { ws = readWorkspace(this.paths.workspaceYaml(row.id)); } catch { ws = null; }
      }
      const name = ws && typeof ws.name === 'string' ? ws.name : null;
      const wsSummary = ws && typeof ws.summary === 'string' ? ws.summary : null;
      const userNamed = !!(ws && ws.user_named);
      const summary = wsSummary || row.dbSummary || '';
      // Display title precedence: user-named workspace name > db summary > workspace name (auto-generated) > id prefix
      const idPrefix = String(row.id).slice(0, 8);
      let displayTitle;
      if (userNamed && name) displayTitle = name;
      else if (row.dbSummary) displayTitle = row.dbSummary;
      else if (name) displayTitle = name;
      else displayTitle = idPrefix;

      const eventsPath = this.paths.eventsJsonl(row.id);
      let sizeBytes = 0;
      try { sizeBytes = fs.statSync(eventsPath).size; } catch { /* missing */ }

      const inUse = hasState ? isInUse(sessionDir) : false;
      const hasStaleLock = hasState ? listStaleLocks(sessionDir).length > 0 : false;

      const project = row.cwd ? path.basename(row.cwd) : '(no cwd)';

      const session = {
        id: row.id,
        cwd: row.cwd || '',
        project,
        displayTitle,
        name,
        summary,
        dbSummary: row.dbSummary || '',
        userNamed,
        repository: row.repository || '',
        branch: row.branch || '',
        hostType: row.hostType || '',
        createdAt: row.createdAt || '',
        updatedAt: row.updatedAt || '',
        messageCount: row.messageCount || 0,
        checkpointCount: cpCounts.get(row.id) || 0,
        fileCount: fileCounts.get(row.id) || 0,
        refCount: refCounts.get(row.id) || 0,
        sizeBytes,
        inUse,
        hasStaleLock,
        hasState,
      };
      out.push(session);
    }

    if (excludePatterns && excludePatterns.length) {
      const regs = excludePatterns.map((p) => new RegExp(p));
      return out.filter((s) => !regs.some((r) => r.test(s.cwd) || r.test(s.displayTitle) || r.test(s.id)));
    }
    return out;
  }

  /** Returns the last `limit` turns for a session, oldest first. */
  recentTurns(sessionId, limit = 30) {
    const db = this._openRead();
    return db.prepare(`
      SELECT turn_index AS turnIndex, user_message AS userMessage, assistant_response AS assistantResponse, timestamp
      FROM turns WHERE session_id = ? ORDER BY turn_index DESC LIMIT ?
    `).all(sessionId, limit).reverse();
  }

  /** Returns checkpoint summaries for a session, oldest first. */
  checkpoints(sessionId) {
    const tbl = this.tables();
    if (!tbl.optional.checkpoints) return [];
    const db = this._openRead();
    return db.prepare(`
      SELECT checkpoint_number AS n, title, overview, created_at AS createdAt
      FROM checkpoints WHERE session_id = ? ORDER BY checkpoint_number ASC
    `).all(sessionId);
  }

  /** Returns touched files for a session. */
  files(sessionId) {
    const tbl = this.tables();
    if (!tbl.optional.session_files) return [];
    const db = this._openRead();
    return db.prepare(`
      SELECT file_path AS filePath, tool_name AS toolName, turn_index AS turnIndex, first_seen_at AS firstSeenAt
      FROM session_files WHERE session_id = ? ORDER BY turn_index ASC, file_path ASC
    `).all(sessionId);
  }

  /** Returns refs (PRs/issues/commits/etc.) for a session. */
  refs(sessionId) {
    const tbl = this.tables();
    if (!tbl.optional.session_refs) return [];
    const db = this._openRead();
    return db.prepare(`
      SELECT ref_type AS refType, ref_value AS refValue, turn_index AS turnIndex, created_at AS createdAt
      FROM session_refs WHERE session_id = ? ORDER BY created_at ASC
    `).all(sessionId);
  }

  /** Full-text search across the FTS5 search_index, returning matching session ids. */
  searchContent(query, { limit = 100 } = {}) {
    const tbl = this.tables();
    if (!tbl.optional.search_index) return [];
    const db = this._openRead();
    const safe = ftsQuote(String(query || '').trim());
    if (!safe) return [];
    let rows;
    try {
      rows = db.prepare(`
        SELECT DISTINCT session_id FROM search_index WHERE search_index MATCH ? LIMIT ?
      `).all(safe, limit);
    } catch (e) {
      if (e && e.code === 'SQLITE_ERROR') return [];
      throw e;
    }
    return rows.map((r) => r.session_id);
  }

  // -------- Mutations --------

  /**
   * Rename a session by updating ONLY workspace.yaml. Does not touch
   * sessions.summary in the DB (Copilot may regenerate it).
   * Throws if the session is in use.
   */
  rename(sessionId, newName) {
    if (!isUuidLike(sessionId)) {
      throw Object.assign(new Error(`Invalid session id: ${sessionId}`), { code: 'INVALID_SESSION_ID' });
    }
    const sessionDir = this.paths.sessionDir(sessionId);
    if (!fs.existsSync(sessionDir)) {
      throw Object.assign(new Error(`Session state directory missing for ${sessionId}`), { code: 'STATE_MISSING' });
    }
    if (isInUse(sessionDir)) {
      throw Object.assign(new Error('Session is currently in use; cannot rename.'), { code: 'IN_USE' });
    }
    const trimmed = String(newName).trim();
    if (!trimmed) {
      throw Object.assign(new Error('Name cannot be empty.'), { code: 'EMPTY_NAME' });
    }
    return updateWorkspaceName(this.paths.workspaceYaml(sessionId), trimmed);
  }

  /**
   * Delete a session: filesystem state directory + all DB rows in the
   * shared store. Refuses if in use. Validates id and target path stay
   * inside the session-state root.
   * Returns { rowsDeleted, dirRemoved }.
   */
  delete(sessionId) {
    if (!isUuidLike(sessionId)) {
      throw Object.assign(new Error(`Invalid session id: ${sessionId}`), { code: 'INVALID_SESSION_ID' });
    }
    const sessionDir = this.paths.sessionDir(sessionId);
    const stateRoot = path.resolve(this.paths.sessionStateDir);
    const target = path.resolve(sessionDir);
    if (!target.startsWith(stateRoot + path.sep)) {
      throw Object.assign(new Error(`Refusing to delete path outside of ${stateRoot}: ${target}`), { code: 'PATH_ESCAPE' });
    }

    if (fs.existsSync(sessionDir) && isInUse(sessionDir)) {
      throw Object.assign(new Error('Session is currently in use; cannot delete.'), { code: 'IN_USE' });
    }

    const tbl = this.tables();
    const db = this._openWrite();

    // DB transaction first. If FS deletion fails afterwards, the session
    // simply has an orphan state dir — easier to recover than orphan rows.
    let rowsDeleted = 0;
    const tx = db.transaction((id) => {
      const stmts = [];
      stmts.push(db.prepare('DELETE FROM turns WHERE session_id = ?'));
      if (tbl.optional.checkpoints) stmts.push(db.prepare('DELETE FROM checkpoints WHERE session_id = ?'));
      if (tbl.optional.session_files) stmts.push(db.prepare('DELETE FROM session_files WHERE session_id = ?'));
      if (tbl.optional.session_refs) stmts.push(db.prepare('DELETE FROM session_refs WHERE session_id = ?'));
      if (tbl.optional.search_index) stmts.push(db.prepare('DELETE FROM search_index WHERE session_id = ?'));
      stmts.push(db.prepare('DELETE FROM sessions WHERE id = ?'));
      for (const s of stmts) rowsDeleted += s.run(id).changes;
    });
    tx(sessionId);

    let dirRemoved = false;
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      dirRemoved = true;
    }
    return { rowsDeleted, dirRemoved };
  }
}

module.exports = { SessionStore, isUuidLike, ftsQuote };
