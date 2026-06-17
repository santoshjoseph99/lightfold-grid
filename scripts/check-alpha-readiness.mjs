#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateAlphaReadiness, formatAlphaReadinessMarkdown, repositoryReadinessPassed } from '../src/services/alphaReadiness.ts';

const root = resolve(import.meta.dirname, '..');
const paths = [
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  'BENCHMARKS.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'GOVERNANCE.md',
  'HOSTED_VALIDATION.md',
  'KNOWN_LIMITATIONS.md',
  'LICENSE',
  'PUBLIC_ALPHA_CHECKLIST.md',
  'README.md',
  'RELEASE_SIGNING.md',
  'SECURITY.md',
  'SOURCE_PROVENANCE.md',
  'SUPPORT.md',
  'benchmarks/live-example/campaign.json',
  'benchmark-results/latest.json',
  'hosted-validation/example.json',
  'tests/observability.test.ts',
  'tests/security-policy.test.ts',
  'tests/workflow.test.ts',
  'tests/worktree.test.ts',
];
const files = Object.fromEntries(paths.map((path) => [path, readFileSync(resolve(root, path), 'utf8')]));
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const checks = evaluateAlphaReadiness({ packageJson, files });
process.stdout.write(formatAlphaReadinessMarkdown(checks));
if (!repositoryReadinessPassed(checks)) process.exitCode = 1;
