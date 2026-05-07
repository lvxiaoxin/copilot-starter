'use strict';

/**
 * cli.js
 * ------
 * Argument parsing for the `copilot-starter` binary. Mirrors the surface
 * area of `claude-starter` so muscle memory transfers, but with
 * Copilot-specific flags.
 */

const HELP = `Usage: copilot-starter [options]

A beautiful TUI for managing GitHub Copilot CLI sessions.

Options:
  (no args)            Launch the interactive TUI
  --list [N]           Print the latest N sessions (default: 30) and exit
  --search <query>     With --list, filter by query (matches metadata + FTS5 content)
  --exclude <pattern>  Exclude sessions whose cwd/title/id matches the regex
                       (repeatable)
  --copilot-home <dir> Override $HOME/.copilot (also via $COPILOT_HOME)
  --version, -v        Print version and exit
  --help, -h           Print this help and exit

Keyboard shortcuts (TUI mode):
  ↑/↓ or j/k           Navigate sessions
  Enter                Resume selected / start a new session
  n                    Start a new copilot session
  /                    Instant search (type to filter)
  Esc                  Clear search / cancel
  Backspace            Edit search; auto-exit when empty
  p                    Filter by project
  s                    Cycle sort: updated → messages → checkpoints → files → project → name
  r                    Rename selected session
  c                    Copy session id to clipboard
  x or Delete          Delete selected session
  g / G                Jump to top / bottom
  Ctrl-D / Ctrl-U      Page down / up
  q or Ctrl-C          Quit

Storage:
  Reads ~/.copilot/session-store.db (read-only by default) and per-session
  state in ~/.copilot/session-state/<id>/. Resumes by spawning
  \`copilot --resume=<id>\`.
`;

function parseArgs(argv) {
  const args = {
    list: false,
    listN: 30,
    search: '',
    exclude: [],
    copilotHome: null,
    version: false,
    help: false,
    _errors: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a === '--version' || a === '-v') { args.version = true; continue; }
    if (a === '--list') {
      args.list = true;
      const next = argv[i + 1];
      if (next && /^\d+$/.test(next)) { args.listN = parseInt(next, 10); i += 1; }
      continue;
    }
    if (a === '--search') {
      args.search = String(argv[i + 1] || '');
      i += 1;
      continue;
    }
    if (a === '--exclude') {
      const v = argv[i + 1];
      if (v) { args.exclude.push(v); i += 1; }
      else args._errors.push('--exclude requires a pattern');
      continue;
    }
    if (a === '--copilot-home') {
      args.copilotHome = argv[i + 1] || null;
      i += 1;
      continue;
    }
    args._errors.push(`Unknown option: ${a}`);
  }
  return args;
}

module.exports = { parseArgs, HELP };
