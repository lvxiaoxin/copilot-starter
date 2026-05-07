'use strict';

/**
 * clipboard.js
 * ------------
 * Cross-platform clipboard write that never goes through a shell.
 * Copies via pbcopy (macOS), wl-copy (Wayland), xclip / xsel (X11).
 * Returns { ok: boolean, tool: string|null }.
 */

const { spawn } = require('child_process');

function tryCopy(cmd, args, text) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'], shell: false });
    } catch {
      return resolve(false);
    }
    proc.on('error', () => resolve(false));
    proc.on('exit', (code) => resolve(code === 0));
    try {
      proc.stdin.end(text);
    } catch {
      resolve(false);
    }
  });
}

async function copyToClipboard(text) {
  const candidates = [
    { tool: 'pbcopy', cmd: 'pbcopy', args: [] },
    { tool: 'wl-copy', cmd: 'wl-copy', args: [] },
    { tool: 'xclip', cmd: 'xclip', args: ['-selection', 'clipboard'] },
    { tool: 'xsel', cmd: 'xsel', args: ['--clipboard', '--input'] },
  ];
  for (const c of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await tryCopy(c.cmd, c.args, String(text));
    if (ok) return { ok: true, tool: c.tool };
  }
  return { ok: false, tool: null };
}

module.exports = { copyToClipboard };
