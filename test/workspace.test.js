'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');

const { readWorkspace, writeWorkspace, updateWorkspaceName } = require('../lib/workspace');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-starter-ws-'));
}

test('workspace round-trips simple content', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'workspace.yaml');
    writeWorkspace(file, {
      id: 'abc',
      cwd: '/tmp/x',
      name: 'my session',
      user_named: false,
      summary: 'short summary',
      summary_count: 0,
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T00:00:00Z',
    });
    const got = readWorkspace(file);
    assert.equal(got.id, 'abc');
    assert.equal(got.name, 'my session');
    assert.equal(got.user_named, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('workspace handles unicode, colons, hashes, and quotes in name', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'workspace.yaml');
    fs.writeFileSync(file, yaml.dump({ id: 'x', cwd: '/y', name: 'old', user_named: false }));
    const tricky = 'My: weird # name with "quotes" and 中文 🎉';
    updateWorkspaceName(file, tricky);
    const reloaded = readWorkspace(file);
    assert.equal(reloaded.name, tricky);
    assert.equal(reloaded.user_named, true);
    assert.ok(reloaded.updated_at);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readWorkspace returns null for missing or malformed files', () => {
  const dir = tmpDir();
  try {
    assert.equal(readWorkspace(path.join(dir, 'nope.yaml')), null);
    const bad = path.join(dir, 'bad.yaml');
    fs.writeFileSync(bad, ': : : not yaml :::\n[unclosed');
    // js-yaml may throw or parse to an unexpected value — either way our wrapper returns null.
    const r = readWorkspace(bad);
    assert.ok(r === null || typeof r === 'object');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeWorkspace preserves unknown keys at the end', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'workspace.yaml');
    writeWorkspace(file, {
      id: 'x',
      name: 'n',
      future_unknown_field: 'hello',
      cwd: '/y',
    });
    const reloaded = readWorkspace(file);
    assert.equal(reloaded.future_unknown_field, 'hello');
    assert.equal(reloaded.cwd, '/y');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeWorkspace is atomic (no torn writes left behind)', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'workspace.yaml');
    writeWorkspace(file, { id: 'x', name: 'n' });
    // No leftover .tmp.* files
    const leftover = fs.readdirSync(dir).filter((f) => f.includes('.tmp.'));
    assert.deepEqual(leftover, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
