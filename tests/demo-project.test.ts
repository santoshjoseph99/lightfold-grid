import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createDemoProject } from '../electron/demoProject.ts';

test('creates a clean demo Git repository from the bundled template', () => {
  const parent = mkdtempSync(join(tmpdir(), 'lightfold-grid-demo-project-'));
  const template = fileURLToPath(new URL('../examples/demo-repository', import.meta.url));
  try {
    const target = createDemoProject(template, parent);
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: target, encoding: 'utf8' }), '');
    execFileSync(process.execPath, ['--test'], { cwd: target, stdio: 'ignore' });
    assert.throws(() => createDemoProject(template, parent), /already exists/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
