'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { makeFixture } = require('./_fixture');
const { SessionStore, isUuidLike } = require('../lib/sessions');

function uuid(n) {
  // Deterministic UUID-like ids for tests.
  const hex = n.toString(16).padStart(2, '0').repeat(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

test('isUuidLike accepts canonical UUIDs and rejects others', () => {
  assert.equal(isUuidLike('61a85c21-6fdc-4e9b-b481-d502247d32a0'), true);
  assert.equal(isUuidLike('not-a-uuid'), false);
  assert.equal(isUuidLike('../escape'), false);
  assert.equal(isUuidLike(''), false);
});

test('listSessions returns sessions with normalized fields and counts', () => {
  const fx = makeFixture();
  try {
    const a = uuid(1);
    const b = uuid(2);
    fx.seedSession({
      id: a,
      cwd: '/Users/dev/repo-a',
      repository: 'org/a',
      branch: 'main',
      summary: 'fix bug in auth',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
      turns: [
        { user: 'fix the auth bug', assistant: 'sure, looking at it' },
        { user: 'thanks', assistant: 'done' },
      ],
      checkpoints: [{ title: 'cp1' }],
      files: [{ filePath: 'src/auth.ts' }, { filePath: 'README.md' }],
      refs: [{ refType: 'pr', refValue: '42' }],
      eventsBytes: 12345,
    });
    fx.seedSession({
      id: b,
      cwd: '/Users/dev/repo-b',
      repository: 'org/b',
      branch: 'feat/x',
      summary: 'add new endpoint',
      createdAt: '2026-04-03T00:00:00.000Z',
      updatedAt: '2026-04-04T00:00:00.000Z',
      turns: [{ user: 'add endpoint', assistant: 'on it' }],
      eventsBytes: 5000,
    });

    const store = new SessionStore({ home: fx.home });
    try {
      const list = store.listSessions();
      assert.equal(list.length, 2);
      // newest first
      assert.equal(list[0].id, b);
      assert.equal(list[1].id, a);

      const sa = list.find((s) => s.id === a);
      assert.equal(sa.project, 'repo-a');
      assert.equal(sa.repository, 'org/a');
      assert.equal(sa.branch, 'main');
      assert.equal(sa.messageCount, 2);
      assert.equal(sa.checkpointCount, 1);
      assert.equal(sa.fileCount, 2);
      assert.equal(sa.refCount, 1);
      assert.equal(sa.sizeBytes, 12345);
      assert.equal(sa.inUse, false);
      assert.equal(sa.displayTitle, 'fix bug in auth');
    } finally {
      store.close();
    }
  } finally {
    fx.cleanup();
  }
});

test('rename writes workspace.yaml and does NOT touch sessions.summary', () => {
  const fx = makeFixture();
  try {
    const id = uuid(3);
    fx.seedSession({
      id,
      cwd: '/tmp/x',
      summary: 'auto-generated summary',
      name: 'auto-generated summary',
      userNamed: false,
    });
    const store = new SessionStore({ home: fx.home });
    try {
      const newName = 'My Custom: Name 🎉 with #hash and "quotes"';
      store.rename(id, newName);

      // Workspace updated
      const wsPath = path.join(fx.home, 'session-state', id, 'workspace.yaml');
      const yaml = require('js-yaml');
      const ws = yaml.load(fs.readFileSync(wsPath, 'utf-8'));
      assert.equal(ws.name, newName);
      assert.equal(ws.user_named, true);

      // DB summary untouched
      const Database = require('better-sqlite3');
      const db = new Database(path.join(fx.home, 'session-store.db'), { readonly: true });
      const row = db.prepare('SELECT summary FROM sessions WHERE id = ?').get(id);
      db.close();
      assert.equal(row.summary, 'auto-generated summary');

      // Display title now uses workspace.name (user_named = true)
      const list = store.listSessions();
      const s = list.find((x) => x.id === id);
      assert.equal(s.displayTitle, newName);
      assert.equal(s.userNamed, true);
    } finally {
      store.close();
    }
  } finally {
    fx.cleanup();
  }
});

test('rename refuses empty name and live in-use lock', () => {
  const fx = makeFixture();
  try {
    const id = uuid(4);
    fx.seedSession({ id, cwd: '/tmp/x' });
    const store = new SessionStore({ home: fx.home });
    try {
      assert.throws(() => store.rename(id, '   '), /empty/i);

      // Add a live lock (use this process's pid — guaranteed alive)
      const lock = path.join(fx.home, 'session-state', id, `inuse.${process.pid}.lock`);
      fs.writeFileSync(lock, String(process.pid));
      assert.throws(() => store.rename(id, 'something'), /in use/i);
    } finally {
      store.close();
    }
  } finally {
    fx.cleanup();
  }
});

test('delete removes all DB rows (incl. FTS5) and the state directory', () => {
  const fx = makeFixture();
  try {
    const id = uuid(5);
    const other = uuid(6);
    fx.seedSession({
      id,
      cwd: '/tmp/x',
      summary: 'gonna delete',
      turns: [
        { user: 'find unique-token-X', assistant: 'sure' },
        { user: 'more', assistant: 'data' },
      ],
      checkpoints: [{ title: 'cp1' }],
      files: [{ filePath: 'a.ts' }],
      refs: [{ refType: 'pr', refValue: '99' }],
      eventsBytes: 1000,
    });
    fx.seedSession({
      id: other,
      cwd: '/tmp/y',
      summary: 'keep me',
      turns: [{ user: 'unique-token-X also here', assistant: 'ok' }],
    });

    const store = new SessionStore({ home: fx.home });
    try {
      // Sanity: FTS finds both before delete
      const beforeIds = store.searchContent('unique-token-X');
      assert.deepEqual(new Set(beforeIds), new Set([id, other]));

      const result = store.delete(id);
      assert.ok(result.rowsDeleted >= 5, `expected several rows deleted, got ${result.rowsDeleted}`);
      assert.equal(result.dirRemoved, true);

      // Filesystem gone
      assert.equal(fs.existsSync(path.join(fx.home, 'session-state', id)), false);
      // The OTHER session still on disk
      assert.equal(fs.existsSync(path.join(fx.home, 'session-state', other)), true);

      // Direct DB check for orphans across every per-session table
      const Database = require('better-sqlite3');
      const db = new Database(path.join(fx.home, 'session-store.db'), { readonly: true });
      try {
        const c = (sql) => db.prepare(sql).get(id).c;
        assert.equal(c('SELECT COUNT(*) AS c FROM sessions WHERE id = ?'), 0);
        assert.equal(c('SELECT COUNT(*) AS c FROM turns WHERE session_id = ?'), 0);
        assert.equal(c('SELECT COUNT(*) AS c FROM checkpoints WHERE session_id = ?'), 0);
        assert.equal(c('SELECT COUNT(*) AS c FROM session_files WHERE session_id = ?'), 0);
        assert.equal(c('SELECT COUNT(*) AS c FROM session_refs WHERE session_id = ?'), 0);
        assert.equal(c('SELECT COUNT(*) AS c FROM search_index WHERE session_id = ?'), 0);
      } finally {
        db.close();
      }

      // FTS now only matches the surviving session
      const afterIds = store.searchContent('unique-token-X');
      assert.deepEqual(afterIds, [other]);
    } finally {
      store.close();
    }
  } finally {
    fx.cleanup();
  }
});

test('delete refuses live lock and refuses non-uuid id', () => {
  const fx = makeFixture();
  try {
    const id = uuid(7);
    fx.seedSession({ id, cwd: '/tmp/x' });
    const lock = path.join(fx.home, 'session-state', id, `inuse.${process.pid}.lock`);
    fs.writeFileSync(lock, String(process.pid));

    const store = new SessionStore({ home: fx.home });
    try {
      assert.throws(() => store.delete(id), /in use/i);
      assert.throws(() => store.delete('../etc/passwd'), /Invalid session id/i);
    } finally {
      store.close();
    }
  } finally {
    fx.cleanup();
  }
});

test('delete with stale lock succeeds', () => {
  const fx = makeFixture();
  try {
    const id = uuid(8);
    fx.seedSession({ id, cwd: '/tmp/x' });
    // PID 1 exists but isn't us; pick a pid that is almost certainly dead.
    // Use 2147483646 (max int32 - 1) which is essentially never assigned.
    const stalePid = 2147483646;
    const lock = path.join(fx.home, 'session-state', id, `inuse.${stalePid}.lock`);
    fs.writeFileSync(lock, String(stalePid));

    const store = new SessionStore({ home: fx.home });
    try {
      const r = store.delete(id);
      assert.equal(r.dirRemoved, true);
    } finally {
      store.close();
    }
  } finally {
    fx.cleanup();
  }
});

test('listSessions handles missing state directory and missing workspace.yaml', () => {
  const fx = makeFixture();
  try {
    const id = uuid(9);
    fx.seedSession({ id, cwd: '/tmp/x', summary: 'orphan', writeWorkspace: false });
    const store = new SessionStore({ home: fx.home });
    try {
      const list = store.listSessions();
      assert.equal(list.length, 1);
      assert.equal(list[0].hasState, false);
      assert.equal(list[0].displayTitle, 'orphan'); // falls back to db summary
      assert.equal(list[0].sizeBytes, 0);
    } finally {
      store.close();
    }
  } finally {
    fx.cleanup();
  }
});

test('listSessions excludePatterns filters out matching entries', () => {
  const fx = makeFixture();
  try {
    fx.seedSession({ id: uuid(10), cwd: '/tmp/keep', summary: 'keep' });
    fx.seedSession({ id: uuid(11), cwd: '/tmp/junk', summary: 'noise' });
    const store = new SessionStore({ home: fx.home });
    try {
      const all = store.listSessions();
      const filtered = store.listSessions({ excludePatterns: ['junk'] });
      assert.equal(all.length, 2);
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].cwd, '/tmp/keep');
    } finally {
      store.close();
    }
  } finally {
    fx.cleanup();
  }
});
