import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { agentHelperPath, brokerDatabasePath, demoTemplatePath, rendererEntryPath, workspaceConfigPath } from '../electron/productPaths.ts';

test('uses Lightfold Grid paths for new installations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lightfold-grid-paths-'));
  try {
    assert.equal(brokerDatabasePath(directory), join(directory, 'lightfold-grid-broker.sqlite'));
    assert.equal(workspaceConfigPath(directory), join(directory, 'lightfold-grid-workspace.json'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('continues using existing Starlight data until a Lightfold Grid file exists', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lightfold-grid-legacy-paths-'));
  try {
    writeFileSync(join(directory, 'starlight-broker.sqlite'), '');
    writeFileSync(join(directory, 'starlight-workspace.json'), '{}');
    assert.equal(brokerDatabasePath(directory), join(directory, 'starlight-broker.sqlite'));
    assert.equal(workspaceConfigPath(directory), join(directory, 'starlight-workspace.json'));

    writeFileSync(join(directory, 'lightfold-grid-broker.sqlite'), '');
    writeFileSync(join(directory, 'lightfold-grid-workspace.json'), '{}');
    assert.equal(brokerDatabasePath(directory), join(directory, 'lightfold-grid-broker.sqlite'));
    assert.equal(workspaceConfigPath(directory), join(directory, 'lightfold-grid-workspace.json'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('finds legacy data after Electron changes the application-data directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'lightfold-grid-app-data-'));
  const currentDirectory = join(root, 'lightfold-grid');
  const legacyDirectory = join(root, 'starlight');
  try {
    writeFileSync(join(root, '.keep'), '');
    mkdirSync(currentDirectory);
    mkdirSync(legacyDirectory);
    writeFileSync(join(legacyDirectory, 'starlight-broker.sqlite'), '');
    writeFileSync(join(legacyDirectory, 'starlight-workspace.json'), '{}');
    assert.equal(brokerDatabasePath(currentDirectory, legacyDirectory), join(legacyDirectory, 'starlight-broker.sqlite'));
    assert.equal(workspaceConfigPath(currentDirectory, legacyDirectory), join(legacyDirectory, 'starlight-workspace.json'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolves the packaged renderer beside the compiled Electron directory', () => {
  assert.equal(
    rendererEntryPath(join('app.asar', 'dist-electron')),
    join('app.asar', 'dist', 'index.html'),
  );
});

test('resolves the external agent helper outside a packaged asar', () => {
  assert.equal(
    agentHelperPath(join('resources', 'app.asar'), 'resources', true),
    join('resources', 'bin', 'lightfold-message.mjs'),
  );
  assert.equal(
    agentHelperPath('repository', 'resources', false),
    join('repository', 'bin', 'lightfold-message.mjs'),
  );
});

test('resolves the demo template from packaged resources', () => {
  assert.equal(
    demoTemplatePath(join('resources', 'app.asar'), 'resources', true),
    join('resources', 'examples', 'demo-repository'),
  );
});
