import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateGitHubBootstrap,
  formatGitHubBootstrapMarkdown,
  repositoryGitHubBootstrapPassed,
} from '../src/services/githubBootstrap.ts';

const readyInput = {
  files: {
    '.github/workflows/ci.yml': 'ubuntu-latest macos-latest windows-latest npm test',
    '.github/workflows/release.yml': 'workflow_dispatch v*-alpha.* gh release create',
    '.github/workflows/codeql.yml': 'github/codeql-action/init@v3 javascript-typescript',
    '.github/workflows/dependency-review.yml': 'dependency-review-action@v4 fail-on-severity: high',
    '.github/workflows/secret-scan.yml': 'gitleaks/gitleaks-action@v2',
    '.github/dependabot.yml': 'package-ecosystem: npm package-ecosystem: github-actions',
    '.github/labels.yml': 'name: good first issue name: adapter name: security',
    '.github/pull_request_template.md': 'Verification Security And Compatibility AI assistance',
    'GITHUB_SETUP.md': 'git remote add origin git push -u origin main Require pull requests RELEASE_SIGNING.md First Hosted Validation',
  },
  git: { currentBranch: 'main', remotes: [] },
};

test('repository GitHub bootstrap readiness passes while push work remains external', () => {
  const checks = evaluateGitHubBootstrap(readyInput);
  assert.equal(repositoryGitHubBootstrapPassed(checks), true);
  assert.equal(checks.filter((check) => check.external && check.status === 'block').length, 3);
  assert.match(formatGitHubBootstrapMarkdown(checks), /Repository readiness: PASS/);
});

test('GitHub origin remote is recognized without completing hosted evidence', () => {
  const checks = evaluateGitHubBootstrap({
    ...readyInput,
    git: { currentBranch: 'main', remotes: ['origin\tgit@github.com:owner/lightfold-grid.git (fetch)'] },
  });
  assert.equal(checks.find((check) => check.id === 'origin-remote')?.status, 'pass');
  assert.equal(repositoryGitHubBootstrapPassed(checks), true);
});

test('missing workflow evidence blocks repository GitHub bootstrap readiness', () => {
  const checks = evaluateGitHubBootstrap({
    ...readyInput,
    files: { ...readyInput.files, '.github/workflows/ci.yml': 'ubuntu-latest npm test' },
  });
  assert.equal(repositoryGitHubBootstrapPassed(checks), false);
  assert.equal(checks.find((check) => check.id === 'actions-workflows')?.status, 'block');
});
