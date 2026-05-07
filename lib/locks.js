'use strict';

/**
 * locks.js
 * --------
 * Detects whether a Copilot session is currently in use by inspecting
 * `inuse.<pid>.lock` files. A stale lock (PID no longer alive) is *not*
 * considered "in use".
 */

const fs = require('fs');
const path = require('path');

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e.code === 'EPERM') return true;
    return false;
  }
}

function listLockFiles(sessionDir) {
  let entries;
  try {
    entries = fs.readdirSync(sessionDir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of entries) {
    const m = name.match(/^inuse\.(\d+)\.lock$/);
    if (!m) continue;
    const pid = parseInt(m[1], 10);
    out.push({ name, pid, full: path.join(sessionDir, name), alive: pidIsAlive(pid) });
  }
  return out;
}

function isInUse(sessionDir) {
  return listLockFiles(sessionDir).some((l) => l.alive);
}

function listStaleLocks(sessionDir) {
  return listLockFiles(sessionDir).filter((l) => !l.alive);
}

module.exports = { pidIsAlive, listLockFiles, isInUse, listStaleLocks };
