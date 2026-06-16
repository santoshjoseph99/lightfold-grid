#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  evaluateGitHubBootstrap,
  formatGitHubBootstrapMarkdown,
  repositoryGitHubBootstrapPassed,
} from '../src/services/githubBootstrap.ts';

const root = resolve(import.meta.dirname, '..');
const paths = [
  '.github/dependabot.yml',
  '.github/labels.yml',
  '.github/pull_request_template.md',
  '.github/workflows/ci.yml',
  '.github/workflows/codeql.yml',
  '.github/workflows/dependency-review.yml',
  '.github/workflows/release.yml',
  '.github/workflows/secret-scan.yml',
  'GITHUB_SETUP.md',
];
const files = Object.fromEntries(paths.map((path) => [path, readFileSync(resolve(root, path), 'utf8')]));
const branch = spawnSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' });
const remotes = spawnSync('git', ['remote', '-v'], { cwd: root, encoding: 'utf8' });
const upstream = spawnSync('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
  cwd: root,
  encoding: 'utf8',
});
const aheadBehind = spawnSync('git', ['rev-list', '--left-right', '--count', 'HEAD...@{u}'], {
  cwd: root,
  encoding: 'utf8',
});
const [aheadCount] = aheadBehind.status === 0
  ? aheadBehind.stdout.trim().split(/\s+/).map((value) => Number(value))
  : [undefined];
const checks = evaluateGitHubBootstrap({
  files,
  git: {
    currentBranch: branch.stdout.trim(),
    upstreamBranch: upstream.status === 0 ? upstream.stdout.trim() : undefined,
    aheadCount,
    remotes: remotes.stdout.split('\n').filter(Boolean),
  },
});
process.stdout.write(formatGitHubBootstrapMarkdown(checks));
if (!repositoryGitHubBootstrapPassed(checks)) process.exitCode = 1;
