'use strict';

/**
 * paths.js
 * --------
 * Centralizes filesystem paths used by Copilot CLI's session storage.
 * Honors $COPILOT_HOME for tests and unusual installs.
 */

const path = require('path');
const os = require('os');

function copilotHome() {
  return process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
}

function paths(home = copilotHome()) {
  return {
    home,
    sessionStoreDb: path.join(home, 'session-store.db'),
    sessionStateDir: path.join(home, 'session-state'),
    sessionDir: (id) => path.join(home, 'session-state', id),
    workspaceYaml: (id) => path.join(home, 'session-state', id, 'workspace.yaml'),
    eventsJsonl: (id) => path.join(home, 'session-state', id, 'events.jsonl'),
    checkpointsDir: (id) => path.join(home, 'session-state', id, 'checkpoints'),
  };
}

module.exports = { copilotHome, paths };
