'use strict';

/**
 * workspace.js
 * ------------
 * Read/write `~/.copilot/session-state/<id>/workspace.yaml`.
 *
 * Uses js-yaml to safely round-trip values (handles names with `:`, `#`,
 * unicode, quotes, etc.). Writes are atomic via sibling temp file + rename.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const KNOWN_KEYS = [
  'id',
  'cwd',
  'name',
  'user_named',
  'summary',
  'summary_count',
  'created_at',
  'updated_at',
];

function readWorkspace(workspacePath) {
  let raw;
  try {
    raw = fs.readFileSync(workspacePath, 'utf-8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  let doc;
  try {
    doc = yaml.load(raw);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object') return null;
  return doc;
}

function writeWorkspace(workspacePath, doc) {
  // Preserve known-key ordering, append unknown keys at the end.
  const ordered = {};
  for (const key of KNOWN_KEYS) {
    if (key in doc) ordered[key] = doc[key];
  }
  for (const key of Object.keys(doc)) {
    if (!(key in ordered)) ordered[key] = doc[key];
  }
  const body = yaml.dump(ordered, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
  });

  const tmp = workspacePath + '.tmp.' + process.pid;
  fs.mkdirSync(path.dirname(workspacePath), { recursive: true });
  fs.writeFileSync(tmp, body, { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, workspacePath);
}

function updateWorkspaceName(workspacePath, name) {
  const doc = readWorkspace(workspacePath) || {};
  doc.name = String(name);
  doc.user_named = true;
  doc.updated_at = new Date().toISOString();
  writeWorkspace(workspacePath, doc);
  return doc;
}

module.exports = { readWorkspace, writeWorkspace, updateWorkspaceName };
