'use strict';

const { isUuidLike } = require('./ids');

function copilotResumeArgs(id) {
  if (!id) return [];
  if (!isUuidLike(id)) {
    throw Object.assign(new Error(`Invalid session id: ${id}`), { code: 'INVALID_SESSION_ID' });
  }
  return ['--resume', id];
}

function copilotSpawnConfig({ id = null, cwd = null, platform = process.platform, comspec = process.env.ComSpec } = {}) {
  const args = copilotResumeArgs(id);
  const options = { stdio: 'inherit', shell: false };
  if (cwd) options.cwd = cwd;

  if (platform === 'win32') {
    // npm's Windows shim is a .cmd file; invoking cmd.exe explicitly avoids shell:true+args DEP0190.
    return {
      command: comspec || 'cmd.exe',
      args: ['/d', '/s', '/c', 'copilot', ...args],
      options,
    };
  }

  return {
    command: 'copilot',
    args,
    options,
  };
}

module.exports = { copilotResumeArgs, copilotSpawnConfig };
