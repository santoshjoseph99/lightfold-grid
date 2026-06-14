#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = resolve(fileURLToPath(new URL('../examples/demo-repository', import.meta.url)));
const target = resolve(process.argv[2] || 'lightfold-grid-demo');

if (existsSync(target)) {
  throw new Error(`Demo target already exists: ${target}`);
}

mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
const git = (args) => execFileSync('git', args, { cwd: target, stdio: 'ignore' });
git(['init', '-b', 'main']);
git(['config', 'user.email', 'lightfold-grid-demo@example.test']);
git(['config', 'user.name', 'Lightfold Grid Demo']);
git(['config', 'core.autocrlf', 'false']);
git(['add', '.']);
git(['commit', '-m', 'Create Lightfold Grid demo repository']);

console.log(`Created demo repository at ${target}`);
