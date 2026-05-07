'use strict';

/**
 * format.js
 * ---------
 * Pure formatting helpers used by both the TUI and the --list mode.
 */

function relTime(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.round(mo / 12);
  return `${yr}y ago`;
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0B';
  const units = ['B', 'K', 'M', 'G'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return v >= 10 || i === 0 ? `${Math.round(v)}${units[i]}` : `${v.toFixed(1)}${units[i]}`;
}

function shortId(id) {
  return id ? String(id).slice(0, 8) : '';
}

function ellipsize(s, n) {
  s = String(s || '');
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + '…';
}

function stripAnsi(s) {
  return String(s || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function escTags(s) {
  // blessed tag escaping: replace `{` with `{open}` and `}` with `{close}`
  return String(s || '').replace(/\{/g, '{open}').replace(/\}/g, '{close}');
}

function singleLine(s, max = 200) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return ellipsize(t, max);
}

module.exports = {
  relTime,
  formatBytes,
  shortId,
  ellipsize,
  stripAnsi,
  escTags,
  singleLine,
};
