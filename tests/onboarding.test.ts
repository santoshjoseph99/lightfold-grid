import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('demo setup creates a clean, passing Git repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'lightfold-grid-onboarding-'));
  const target = join(root, 'demo');
  try {
    const script = fileURLToPath(new URL('../scripts/setup-demo.mjs', import.meta.url));
    const setup = spawnSync(process.execPath, [script, target], { encoding: 'utf8' });
    assert.equal(setup.status, 0, setup.stderr);
    assert.equal(existsSync(join(target, '.git')), true);
    const tests = spawnSync(process.execPath, ['--test'], { cwd: target, encoding: 'utf8' });
    assert.equal(tests.status, 0, tests.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadable onboarding workspaces keep YOLO disabled and define explicit routes', () => {
  for (const name of ['local-ollama-wheel.json', 'mixed-local-cloud-wheel.json']) {
    const file = new URL(`../examples/workspaces/${name}`, import.meta.url);
    const workspace = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(workspace.paneIds.length, 4);
    assert.equal(Object.values(workspace.agentConfigs).every((agent: any) => agent.yoloMode === false), true);
    assert.deepEqual(workspace.connections['Pane-A'], ['Pane-B', 'Pane-C', 'Pane-D']);
  }
});
