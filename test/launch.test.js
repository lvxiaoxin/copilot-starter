'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { copilotSpawnConfig } = require('../lib/launch');

const id = '61a85c21-6fdc-4e9b-b481-d502247d32a0';

test('copilotSpawnConfig uses shell:false on non-Windows', () => {
  const launch = copilotSpawnConfig({ id, cwd: '/tmp/repo', platform: 'darwin' });
  assert.equal(launch.command, 'copilot');
  assert.deepEqual(launch.args, ['--resume', id]);
  assert.deepEqual(launch.options, {
    stdio: 'inherit',
    shell: false,
    cwd: '/tmp/repo',
  });
});

test('copilotSpawnConfig avoids shell:true with args on Windows', () => {
  const launch = copilotSpawnConfig({
    id,
    cwd: 'C:\\repo',
    platform: 'win32',
    comspec: 'C:\\Windows\\System32\\cmd.exe',
  });

  assert.equal(launch.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(launch.args, ['/d', '/s', '/c', 'copilot', '--resume', id]);
  assert.deepEqual(launch.options, {
    stdio: 'inherit',
    shell: false,
    cwd: 'C:\\repo',
  });
});

test('copilotSpawnConfig starts a new Windows session without resume args', () => {
  const launch = copilotSpawnConfig({ platform: 'win32', comspec: null });
  assert.equal(launch.command, 'cmd.exe');
  assert.deepEqual(launch.args, ['/d', '/s', '/c', 'copilot']);
  assert.equal(launch.options.shell, false);
});

test('copilotSpawnConfig rejects unsafe resume ids', () => {
  assert.throws(
    () => copilotSpawnConfig({ id: 'abc & calc.exe', platform: 'win32' }),
    { code: 'INVALID_SESSION_ID' },
  );
});
