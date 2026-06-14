#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const ref = process.env.GITHUB_REF || '';
if (!ref.startsWith('refs/tags/')) {
  console.log('No release tag to validate.');
  process.exit(0);
}

const tag = ref.slice('refs/tags/'.length);
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const expectedTag = `v${version}`;

if (tag !== expectedTag) {
  throw new Error(`Release tag ${tag} does not match package version ${version}; expected ${expectedTag}.`);
}

console.log(`Release tag ${tag} matches package version ${version}.`);
