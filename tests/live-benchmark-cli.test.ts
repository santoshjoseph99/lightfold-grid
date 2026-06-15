import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts', 'validate-live-benchmark.mjs');

test('live benchmark CLI rejects tampered raw evidence bundles', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lightfold-live-benchmark-'));
  try {
    cpSync(join(root, 'benchmarks', 'live-example'), directory, { recursive: true });
    writeFileSync(join(directory, 'evidence.json'), '{"records":[]}\n', 'utf8');
    const result = spawnSync(process.execPath, [
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      '--disable-warning=ExperimentalWarning',
      '--experimental-strip-types',
      script,
      join(directory, 'campaign.json'),
      '--check-only',
    ], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Raw evidence digest mismatch/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
