#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const releaseDirectory = resolve(process.argv[2] || 'release');
const checksumPath = join(releaseDirectory, 'SHA256SUMS.txt');
const sbomPath = join(releaseDirectory, 'lightfold-grid-sbom.spdx.json');

const files = readdirSync(releaseDirectory)
  .map((name) => join(releaseDirectory, name))
  .filter((file) => statSync(file).isFile())
  .filter((file) => ![checksumPath, sbomPath].includes(file))
  .sort();

if (files.length === 0) {
  throw new Error(`No release artifacts found in ${releaseDirectory}`);
}

const checksums = files.map((file) => {
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
  return `${digest}  ${relative(releaseDirectory, file)}`;
});
writeFileSync(checksumPath, `${checksums.join('\n')}\n`, 'utf8');

const npmExecutable = 'npm';
const sbom = spawnSync(npmExecutable, ['sbom', '--sbom-format', 'spdx', '--omit', 'dev'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
if (sbom.status !== 0) {
  throw new Error(`Could not generate SBOM: ${sbom.error?.message || sbom.stderr || sbom.stdout}`);
}
writeFileSync(sbomPath, sbom.stdout, 'utf8');

console.log(`Wrote ${basename(checksumPath)} for ${files.length} artifact(s) and ${basename(sbomPath)}.`);
