#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.argv.includes('--electron-runtime')) {
  const { default: electronPath } = await import('electron');
  const result = spawnSync(electronPath, [import.meta.filename, '--electron-runtime'], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', LIGHTFOLD_SMOKE_NODE: process.execPath },
    timeout: 30_000,
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

const { default: Database } = await import('better-sqlite3');
const { default: pty } = await import('node-pty');

const directory = mkdtempSync(join(tmpdir(), 'lightfold-grid-native-smoke-'));
const removeTemporaryDirectory = async () => {
  const attempts = process.platform === 'win32' ? 8 : 2;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (error) {
      if (attempt === attempts) {
        console.warn(`Could not remove native smoke temp directory ${directory}: ${error.message}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
};

try {
  const database = new Database(join(directory, 'smoke.sqlite'));
  database.exec('CREATE TABLE smoke (value TEXT NOT NULL)');
  database.prepare('INSERT INTO smoke (value) VALUES (?)').run('sqlite-ok');
  assert.equal(database.prepare('SELECT value FROM smoke').get().value, 'sqlite-ok');
  database.close();

  const executable = process.env.LIGHTFOLD_SMOKE_NODE || process.execPath;
  const args = ['-e', "process.stdout.write('pty-ok'); setTimeout(() => process.exit(0), 50)"];
  const terminal = pty.spawn(executable, args, {
    cols: 80,
    rows: 24,
    cwd: directory,
    env: Object.fromEntries(Object.entries(process.env).filter((entry) => entry[1] !== undefined)),
  });
  const output = await new Promise((resolve, reject) => {
    let value = '';
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      finish(() => {
        terminal.kill();
        reject(new Error('node-pty smoke test timed out.'));
      });
    }, 5_000);
    terminal.onData((data) => {
      value += data;
      if (/pty-ok/.test(value)) {
        finish(() => {
          terminal.kill();
          resolve(value);
        });
      }
    });
    terminal.onExit(({ exitCode }) => {
      finish(() => {
        exitCode === 0 && /pty-ok/.test(value)
          ? resolve(value)
          : reject(new Error(`node-pty smoke process exited ${exitCode} with output: ${value}`));
      });
    });
  });
  assert.match(output, /pty-ok/);
  console.log(`Native dependency smoke passed on ${process.platform}/${process.arch}.`);
} finally {
  await removeTemporaryDirectory();
}
