#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const testFiles = readdirSync('tests')
  .filter((name) => name.endsWith('.test.ts'))
  .filter((name) => name !== 'full-pty.integration.test.ts')
  .map((name) => join('tests', name))
  .sort();

const result = spawnSync(process.execPath, [
  '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
  '--disable-warning=ExperimentalWarning',
  '--experimental-strip-types',
  '--test',
  ...testFiles,
], { stdio: 'inherit' });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
