export type GitHubBootstrapStatus = 'pass' | 'block';

export interface GitHubBootstrapCheck {
  id: string;
  label: string;
  status: GitHubBootstrapStatus;
  external: boolean;
  detail: string;
}

export interface GitHubBootstrapInput {
  files: Record<string, string>;
  git?: {
    currentBranch?: string;
    remotes?: string[];
  };
}

const includesAll = (value: string, patterns: RegExp[]) => patterns.every((pattern) => pattern.test(value));

export const evaluateGitHubBootstrap = ({ files, git = {} }: GitHubBootstrapInput): GitHubBootstrapCheck[] => {
  const read = (path: string) => files[path] || '';
  const ci = read('.github/workflows/ci.yml');
  const release = read('.github/workflows/release.yml');
  const codeql = read('.github/workflows/codeql.yml');
  const dependencyReview = read('.github/workflows/dependency-review.yml');
  const secretScan = read('.github/workflows/secret-scan.yml');
  const dependabot = read('.github/dependabot.yml');
  const labels = read('.github/labels.yml');
  const pullRequestTemplate = read('.github/pull_request_template.md');
  const setup = read('GITHUB_SETUP.md');

  const repositoryChecks: GitHubBootstrapCheck[] = [
    {
      id: 'actions-workflows',
      label: 'GitHub Actions workflows',
      status: includesAll(ci, [/ubuntu-latest/, /macos-latest/, /windows-latest/, /npm test/]) &&
        includesAll(release, [/workflow_dispatch/, /v\*-alpha\.\*/, /gh release create/])
        ? 'pass'
        : 'block',
      external: false,
      detail: 'CI and alpha release workflows are present for hosted validation.',
    },
    {
      id: 'security-automation',
      label: 'Security automation',
      status: includesAll(codeql, [/github\/codeql-action\/init@v3/, /javascript-typescript/]) &&
        includesAll(dependencyReview, [/dependency-review-action@v4/, /fail-on-severity: high/]) &&
        includesAll(secretScan, [/gitleaks\/gitleaks-action@v2/])
        ? 'pass'
        : 'block',
      external: false,
      detail: 'CodeQL, dependency review, and secret scanning workflows are configured.',
    },
    {
      id: 'community-templates',
      label: 'Community templates and labels',
      status: includesAll(labels, [/name: good first issue/, /name: adapter/, /name: security/]) &&
        includesAll(pullRequestTemplate, [/Verification/, /Security And Compatibility/, /AI assistance/])
        ? 'pass'
        : 'block',
      external: false,
      detail: 'Contributor labels, issue forms, and pull-request expectations are present.',
    },
    {
      id: 'dependency-maintenance',
      label: 'Dependency maintenance',
      status: includesAll(dependabot, [/package-ecosystem: npm/, /package-ecosystem: github-actions/])
        ? 'pass'
        : 'block',
      external: false,
      detail: 'Dependabot is configured for npm packages and GitHub Actions.',
    },
    {
      id: 'bootstrap-documentation',
      label: 'GitHub bootstrap documentation',
      status: includesAll(setup, [
        /git remote add origin/,
        /git push -u origin main/,
        /Require pull requests/,
        /RELEASE_SIGNING\.md/,
        /First Hosted Validation/,
      ]) ? 'pass' : 'block',
      external: false,
      detail: 'Repository creation, first push, settings, secrets, and validation are documented.',
    },
  ];

  const externalChecks: GitHubBootstrapCheck[] = [
    {
      id: 'origin-remote',
      label: 'GitHub origin remote',
      status: git.remotes?.some((remote) => /^origin\s+.+github\.com[:/]/.test(remote)) ? 'pass' : 'block',
      external: true,
      detail: 'Add an origin remote that points to the GitHub repository.',
    },
    {
      id: 'main-pushed',
      label: 'Main branch pushed to GitHub',
      status: 'block',
      external: true,
      detail: 'Push the main branch and confirm the hosted repository exists.',
    },
    {
      id: 'hosted-actions',
      label: 'Hosted Actions validation',
      status: 'block',
      external: true,
      detail: 'Observe CI, security, and release workflows running on GitHub-hosted runners.',
    },
  ];

  return [...repositoryChecks, ...externalChecks];
};

export const repositoryGitHubBootstrapPassed = (checks: GitHubBootstrapCheck[]) =>
  checks.filter((check) => !check.external).every((check) => check.status === 'pass');

export const formatGitHubBootstrapMarkdown = (checks: GitHubBootstrapCheck[]) => [
  '# GitHub Bootstrap Readiness',
  '',
  '| Gate | Type | Status | Detail |',
  '| --- | --- | --- | --- |',
  ...checks.map((check) =>
    `| ${check.label} | ${check.external ? 'External setup' : 'Repository'} | ${check.status.toUpperCase()} | ${check.detail} |`,
  ),
  '',
  `Repository readiness: ${repositoryGitHubBootstrapPassed(checks) ? 'PASS' : 'BLOCKED'}`,
  '',
].join('\n');
