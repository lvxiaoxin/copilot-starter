'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sortSessions,
  nextSortMode,
  searchSessions,
  projectsOf,
  filterByProject,
  SORT_MODES,
} = require('../lib/filters');

function s(over) {
  return Object.assign({
    id: 'id',
    cwd: '/x',
    project: 'x',
    displayTitle: 'title',
    summary: '',
    repository: '',
    branch: '',
    updatedAt: '2026-04-01T00:00:00Z',
    messageCount: 0,
    checkpointCount: 0,
    fileCount: 0,
  }, over);
}

test('sortSessions: updated mode is newest-first', () => {
  const list = [
    s({ id: '1', updatedAt: '2026-04-01T00:00:00Z' }),
    s({ id: '2', updatedAt: '2026-04-03T00:00:00Z' }),
    s({ id: '3', updatedAt: '2026-04-02T00:00:00Z' }),
  ];
  const out = sortSessions(list, 'updated');
  assert.deepEqual(out.map((x) => x.id), ['2', '3', '1']);
});

test('sortSessions: messages mode prefers higher counts', () => {
  const list = [
    s({ id: '1', messageCount: 1 }),
    s({ id: '2', messageCount: 5 }),
    s({ id: '3', messageCount: 3 }),
  ];
  const out = sortSessions(list, 'messages');
  assert.deepEqual(out.map((x) => x.id), ['2', '3', '1']);
});

test('sortSessions: name mode is alphabetical asc', () => {
  const list = [
    s({ id: '1', displayTitle: 'banana' }),
    s({ id: '2', displayTitle: 'apple' }),
    s({ id: '3', displayTitle: 'cherry' }),
  ];
  const out = sortSessions(list, 'name');
  assert.deepEqual(out.map((x) => x.id), ['2', '1', '3']);
});

test('nextSortMode cycles through all SORT_MODES', () => {
  const seen = new Set();
  let cur = SORT_MODES[0].id;
  for (let i = 0; i < SORT_MODES.length; i += 1) {
    seen.add(cur);
    cur = nextSortMode(cur);
  }
  assert.equal(seen.size, SORT_MODES.length);
});

test('searchSessions: tokens AND-combined across haystack fields', () => {
  const list = [
    s({ id: '1', displayTitle: 'fix login bug', repository: 'org/auth' }),
    s({ id: '2', displayTitle: 'add cart', repository: 'org/shop' }),
    s({ id: '3', displayTitle: 'login refactor', repository: 'org/auth' }),
  ];
  assert.deepEqual(searchSessions(list, 'login').map((x) => x.id), ['1', '3']);
  assert.deepEqual(searchSessions(list, 'login bug').map((x) => x.id), ['1']);
  assert.deepEqual(searchSessions(list, 'auth').map((x) => x.id), ['1', '3']);
});

test('searchSessions: empty query returns everything', () => {
  const list = [s({ id: '1' }), s({ id: '2' })];
  assert.equal(searchSessions(list, '').length, 2);
  assert.equal(searchSessions(list, '   ').length, 2);
});

test('searchSessions: contentIds OR-combined with text match', () => {
  const list = [s({ id: '1', displayTitle: 'apple' }), s({ id: '2', displayTitle: 'banana' })];
  // Only id=2 matches by FTS, id=1 has no text match either.
  const result = searchSessions(list, 'mango', { contentIds: ['2'] });
  assert.deepEqual(result.map((x) => x.id), ['2']);
});

test('projectsOf disambiguates basename collisions', () => {
  const list = [
    s({ id: '1', cwd: '/a/frontend', project: 'frontend' }),
    s({ id: '2', cwd: '/b/frontend', project: 'frontend' }),
    s({ id: '3', cwd: '/c/api', project: 'api' }),
  ];
  const projects = projectsOf(list);
  const labels = projects.map((p) => p.label).sort();
  // Two "frontend" entries should be disambiguated with cwd suffix
  const frontends = labels.filter((l) => l.startsWith('frontend'));
  assert.equal(frontends.length, 2);
  for (const l of frontends) assert.ok(l.includes(' — '), `expected disambig, got ${l}`);
  assert.ok(labels.includes('api'));
});

test('filterByProject narrows to matching cwd', () => {
  const list = [
    s({ id: '1', cwd: '/a' }),
    s({ id: '2', cwd: '/b' }),
    s({ id: '3', cwd: '/a' }),
  ];
  assert.deepEqual(filterByProject(list, '/a').map((x) => x.id), ['1', '3']);
  assert.deepEqual(filterByProject(list, '').length, 3);
});
