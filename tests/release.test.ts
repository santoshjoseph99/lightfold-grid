import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const releaseWorkflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const bundledOllamaAdapter = readFileSync(new URL('../bin/lightfold-ollama-adapter.mjs', import.meta.url), 'utf8');

test('packages the renderer, Electron main process, helpers, and native modules', () => {
  assert.deepEqual(packageJson.build.files, [
    'dist/**/*',
    'dist-electron/**/*',
    'package.json',
  ]);
  assert.deepEqual(packageJson.build.asarUnpack, ['**/*.node']);
  assert.deepEqual(packageJson.build.extraResources[0], {
    from: 'bin',
    to: 'bin',
    filter: ['*.mjs'],
  });
  assert.deepEqual(packageJson.build.extraResources[1], {
    from: 'examples/demo-repository',
    to: 'examples/demo-repository',
  });
  assert.match(bundledOllamaAdapter, /\/api\/chat/);
  assert.match(packageJson.build.artifactName, /\$\{version\}.*\$\{os\}.*\$\{arch\}/);
});

test('tagged alpha releases package every supported desktop platform', () => {
  assert.match(releaseWorkflow, /windows-latest/);
  assert.match(releaseWorkflow, /macos-latest/);
  assert.match(releaseWorkflow, /ubuntu-latest/);
  assert.match(releaseWorkflow, /native:smoke/);
  assert.match(releaseWorkflow, /alpha:readiness/);
  assert.match(releaseWorkflow, /community:readiness/);
  assert.match(releaseWorkflow, /test:integration/);
  assert.match(releaseWorkflow, /generate-release-metadata/);
  assert.match(releaseWorkflow, /gh release create/);
});

test('release metadata contains artifact checksums and an SPDX SBOM', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lightfold-grid-release-'));
  try {
    const artifact = join(directory, 'artifact.zip');
    writeFileSync(artifact, 'release artifact');
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('../scripts/generate-release-metadata.mjs', import.meta.url)),
      directory,
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const expected = createHash('sha256').update('release artifact').digest('hex');
    assert.equal(readFileSync(join(directory, 'SHA256SUMS.txt'), 'utf8'), `${expected}  artifact.zip\n`);
    const sbom = JSON.parse(readFileSync(join(directory, 'lightfold-grid-sbom.spdx.json'), 'utf8'));
    assert.equal(sbom.spdxVersion, 'SPDX-2.3');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('release tags must exactly match the package version', () => {
  const script = fileURLToPath(new URL('../scripts/validate-release-tag.mjs', import.meta.url));
  const matching = spawnSync(process.execPath, [script], {
    env: { ...process.env, GITHUB_REF: `refs/tags/v${packageJson.version}` },
  });
  const mismatched = spawnSync(process.execPath, [script], {
    env: { ...process.env, GITHUB_REF: 'refs/tags/v0.0.0-alpha.invalid' },
  });
  assert.equal(matching.status, 0);
  assert.notEqual(mismatched.status, 0);
});
