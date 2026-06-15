#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  evaluateCommunityReadiness,
  formatCommunityReadinessMarkdown,
  repositoryCommunityReadinessPassed,
} from '../src/services/communityLaunch.ts';

const root = resolve(import.meta.dirname, '..');
const paths = [
  '.github/ISSUE_TEMPLATE/adapter_contribution.yml',
  '.github/ISSUE_TEMPLATE/alpha_feedback.yml',
  '.github/labels.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  'PRIVATE_ALPHA.md',
  'ROADMAP.md',
];
const files = Object.fromEntries(paths.map((path) => [path, readFileSync(resolve(root, path), 'utf8')]));
const checks = evaluateCommunityReadiness({ files });
process.stdout.write(formatCommunityReadinessMarkdown(checks));
if (!repositoryCommunityReadinessPassed(checks)) process.exitCode = 1;
