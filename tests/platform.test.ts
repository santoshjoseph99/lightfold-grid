import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commandExecutable,
  getCommandSpec,
  getDefaultShell,
  getShellArgs,
  isShellProcess,
} from '../electron/platform.js';

test('builds platform-specific approved command runners', () => {
  assert.deepEqual(getCommandSpec('npm test', 'linux'), {
    executable: '/bin/sh',
    args: ['-lc', 'npm test'],
  });
  assert.deepEqual(getCommandSpec('npm test', 'win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }), {
    executable: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', 'npm test'],
  });
});

test('selects platform-specific interactive shell arguments', () => {
  assert.deepEqual(getShellArgs('/bin/zsh', 'darwin'), ['-l']);
  assert.deepEqual(getShellArgs('powershell.exe', 'win32'), ['-NoLogo']);
  assert.deepEqual(getShellArgs('pwsh.exe', 'win32'), ['-NoLogo']);
  assert.deepEqual(getShellArgs('cmd.exe', 'win32'), []);
  assert.deepEqual(getShellArgs('C:\\Program Files\\Git\\bin\\bash.exe', 'win32'), ['--login']);
});

test('normalizes shell and command identities across platforms', () => {
  assert.equal(commandExecutable('"C:\\Program Files\\Agent\\agent.exe" --model fast'), 'C:\\Program Files\\Agent\\agent.exe');
  assert.equal(isShellProcess('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'), true);
  assert.equal(isShellProcess('/bin/zsh'), true);
  assert.equal(isShellProcess('node.exe'), false);
  assert.equal(getDefaultShell('linux', { SHELL: '/bin/bash' }), '/bin/bash');
});
