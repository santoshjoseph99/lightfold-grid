#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  credentialSigningReadinessPassed,
  evaluateSigningReadiness,
  formatSigningReadinessMarkdown,
  repositorySigningReadinessPassed,
} from '../src/services/releaseSigning.ts';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const requireIndex = args.indexOf('--require-credentials');
const requiredPlatform = requireIndex === -1 ? undefined : args[requireIndex + 1];
if (requireIndex !== -1 && !['mac', 'win', 'all'].includes(requiredPlatform)) {
  throw new Error('--require-credentials requires mac, win, or all.');
}
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const paths = [
  '.github/workflows/release.yml',
  'build/entitlements.mac.plist',
  'build/icon.icns',
  'build/icon.png',
  'scripts/notarize.mjs',
];
const files = Object.fromEntries(paths.map((path) => [path, readFileSync(resolve(root, path), 'utf8')]));
const checks = evaluateSigningReadiness({ packageJson, files, environment: process.env });
process.stdout.write(formatSigningReadinessMarkdown(checks));
if (!repositorySigningReadinessPassed(checks)) process.exitCode = 1;
if (requiredPlatform && !credentialSigningReadinessPassed(checks, requiredPlatform)) process.exitCode = 1;
