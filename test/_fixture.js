'use strict';

/**
 * Test fixture: builds a temporary $COPILOT_HOME with a SQLite DB matching
 * Copilot's real schema and per-session state directories. Returns helpers
 * to seed sessions and clean up.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const yaml = require('js-yaml');

const SCHEMA_SQL = [
  `CREATE TABLE schema_version (version INTEGER NOT NULL)`,
  `CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT,
      repository TEXT,
      host_type TEXT,
      branch TEXT,
      summary TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      turn_index INTEGER NOT NULL,
      user_message TEXT,
      assistant_response TEXT,
      timestamp TEXT DEFAULT (datetime('now')),
      UNIQUE(session_id, turn_index)
   )`,
  `CREATE TABLE checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      checkpoint_number INTEGER NOT NULL,
      title TEXT,
      overview TEXT,
      history TEXT,
      work_done TEXT,
      technical_details TEXT,
      important_files TEXT,
      next_steps TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(session_id, checkpoint_number)
   )`,
  `CREATE TABLE session_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      file_path TEXT NOT NULL,
      tool_name TEXT,
      turn_index INTEGER,
      first_seen_at TEXT DEFAULT (datetime('now')),
      UNIQUE(session_id, file_path)
   )`,
  `CREATE TABLE session_refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      ref_type TEXT NOT NULL,
      ref_value TEXT NOT NULL,
      turn_index INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(session_id, ref_type, ref_value)
   )`,
  `CREATE VIRTUAL TABLE search_index USING fts5(
      content,
      session_id UNINDEXED,
      source_type UNINDEXED,
      source_id UNINDEXED
   )`,
];

function makeFixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-starter-test-'));
  fs.mkdirSync(path.join(home, 'session-state'), { recursive: true });
  const dbPath = path.join(home, 'session-store.db');
  const db = new Database(dbPath);
  for (const sql of SCHEMA_SQL) db.exec(sql);
  db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(1);

  const insSession = db.prepare(`INSERT INTO sessions (id, cwd, repository, branch, summary, created_at, updated_at)
                                 VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insTurn = db.prepare(`INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp)
                              VALUES (?, ?, ?, ?, ?)`);
  const insCp = db.prepare(`INSERT INTO checkpoints (session_id, checkpoint_number, title, overview, created_at)
                            VALUES (?, ?, ?, ?, ?)`);
  const insFile = db.prepare(`INSERT INTO session_files (session_id, file_path, tool_name, turn_index, first_seen_at)
                              VALUES (?, ?, ?, ?, ?)`);
  const insRef = db.prepare(`INSERT INTO session_refs (session_id, ref_type, ref_value, turn_index, created_at)
                             VALUES (?, ?, ?, ?, ?)`);
  const insFts = db.prepare(`INSERT INTO search_index (content, session_id, source_type, source_id)
                             VALUES (?, ?, ?, ?)`);

  function seedSession(opts) {
    const {
      id,
      cwd = '/tmp/proj',
      repository = '',
      branch = '',
      summary = '',
      createdAt = '2026-04-01T00:00:00.000Z',
      updatedAt = createdAt,
      name = null,
      userNamed = false,
      turns = [],
      checkpoints = [],
      files = [],
      refs = [],
      eventsBytes = 0,
      lockPid = null,
      writeWorkspace = true,
    } = opts;

    insSession.run(id, cwd, repository, branch, summary, createdAt, updatedAt);
    let i = 0;
    for (const t of turns) {
      insTurn.run(id, i, t.user || '', t.assistant || '', t.timestamp || createdAt);
      insFts.run((t.user || '') + ' ' + (t.assistant || ''), id, 'turn', String(i));
      i += 1;
    }
    let cn = 1;
    for (const c of checkpoints) {
      insCp.run(id, cn, c.title || `cp${cn}`, c.overview || '', createdAt);
      cn += 1;
    }
    for (const f of files) insFile.run(id, f.filePath, f.toolName || 'edit', f.turnIndex || 0, createdAt);
    for (const r of refs) insRef.run(id, r.refType, r.refValue, r.turnIndex || 0, createdAt);

    if (writeWorkspace) {
      const dir = path.join(home, 'session-state', id);
      fs.mkdirSync(dir, { recursive: true });
      const ws = {
        id,
        cwd,
        name: name || summary || `session ${id.slice(0, 8)}`,
        user_named: userNamed,
        summary,
        summary_count: 0,
        created_at: createdAt,
        updated_at: updatedAt,
      };
      fs.writeFileSync(path.join(dir, 'workspace.yaml'), yaml.dump(ws), 'utf-8');
      if (eventsBytes > 0) {
        fs.writeFileSync(path.join(dir, 'events.jsonl'), 'x'.repeat(eventsBytes), 'utf-8');
      }
      if (lockPid) {
        fs.writeFileSync(path.join(dir, `inuse.${lockPid}.lock`), String(lockPid), 'utf-8');
      }
    }
  }

  function cleanup() {
    try { db.close(); } catch { /* noop */ }
    fs.rmSync(home, { recursive: true, force: true });
  }

  return { home, dbPath, db, seedSession, cleanup };
}

module.exports = { makeFixture };
