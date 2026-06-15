export type CommunityReadinessStatus = 'pass' | 'block';

export interface CommunityReadinessCheck {
  id: string;
  label: string;
  status: CommunityReadinessStatus;
  external: boolean;
  detail: string;
}

export interface CommunityReadinessInput {
  files: Record<string, string>;
}

const includesAll = (value: string, patterns: RegExp[]) => patterns.every((pattern) => pattern.test(value));

export const evaluateCommunityReadiness = ({ files }: CommunityReadinessInput): CommunityReadinessCheck[] => {
  const read = (path: string) => files[path] || '';
  const privateAlpha = read('PRIVATE_ALPHA.md');
  const roadmap = read('ROADMAP.md');
  const labels = read('.github/labels.yml');
  const alphaForm = read('.github/ISSUE_TEMPLATE/alpha_feedback.yml');
  const adapterForm = read('.github/ISSUE_TEMPLATE/adapter_contribution.yml');
  const ci = read('.github/workflows/ci.yml');
  const release = read('.github/workflows/release.yml');

  const repositoryChecks: CommunityReadinessCheck[] = [
    {
      id: 'private-alpha-guide',
      label: 'Repeatable private-alpha guide',
      status: includesAll(privateAlpha, [
        /Participant Criteria/,
        /Consent And Privacy/,
        /Session Checklist/,
        /Outcome Record/,
        /Stop Conditions/,
        /without maintainer intervention/i,
      ]) ? 'pass' : 'block',
      external: false,
      detail: 'Participant criteria, consent, observation, outcomes, and safety stops are documented.',
    },
    {
      id: 'structured-alpha-feedback',
      label: 'Structured and privacy-safe alpha feedback',
      status: includesAll(alphaForm, [
        /private alpha/,
        /feedback/,
        /no secrets or private repository content/i,
        /Demo completed without maintainer help/,
        /Session observations/,
      ]) ? 'pass' : 'block',
      external: false,
      detail: 'The issue form captures first-workflow outcomes without requesting sensitive material.',
    },
    {
      id: 'outcome-roadmap',
      label: 'Outcome-driven public roadmap',
      status: includesAll(roadmap, [
        /plans work around outcomes users can demonstrate/i,
        /Understand What Every Agent Is Doing/,
        /Complete A Safe First Workflow/,
        /Spend Strong-Model Tokens Only Where They Matter/,
        /Extend The Model And CLI Ecosystem/,
        /Publish A Trustworthy Developer Alpha/,
      ]) ? 'pass' : 'block',
      external: false,
      detail: 'The public roadmap is organized around measurable user outcomes.',
    },
    {
      id: 'contribution-opportunities',
      label: 'Beginner and adapter contribution opportunities',
      status: includesAll(labels, [
        /name: good first issue/,
        /name: adapter/,
        /name: documentation/,
        /name: private alpha/,
        /name: security/,
      ]) && includesAll(adapterForm, [/adapter/, /contribution/, /ADAPTERS\.md/, /Conformance plan/])
        ? 'pass'
        : 'block',
      external: false,
      detail: 'Required labels and a structured adapter contribution form are defined.',
    },
    {
      id: 'automated-community-gate',
      label: 'Automated community-readiness gate',
      status: /npm run community:readiness/.test(ci) && /npm run community:readiness/.test(release) ? 'pass' : 'block',
      external: false,
      detail: 'Cross-platform CI and release packaging fail when community materials regress.',
    },
  ];

  const externalBlockers: CommunityReadinessCheck[] = [
    {
      id: 'recruit-alpha-users',
      label: 'Recruit independent alpha users',
      status: 'block',
      external: true,
      detail: 'Five to ten participants who did not build the project must be recruited.',
    },
    {
      id: 'observe-alpha-sessions',
      label: 'Observe installation and first-workflow sessions',
      status: 'block',
      external: true,
      detail: 'Real session outcomes and maintainer interventions must be recorded.',
    },
    {
      id: 'public-repository',
      label: 'Create and announce the public repository',
      status: 'block',
      external: true,
      detail: 'Publication waits on the public-alpha gates and requires maintainer action.',
    },
  ];

  return [...repositoryChecks, ...externalBlockers];
};

export const repositoryCommunityReadinessPassed = (checks: CommunityReadinessCheck[]) =>
  checks.filter((check) => !check.external).every((check) => check.status === 'pass');

export const formatCommunityReadinessMarkdown = (checks: CommunityReadinessCheck[]) => [
  '# Community Launch Readiness',
  '',
  '| Gate | Type | Status | Detail |',
  '| --- | --- | --- | --- |',
  ...checks.map((check) =>
    `| ${check.label} | ${check.external ? 'External blocker' : 'Repository'} | ${check.status.toUpperCase()} | ${check.detail} |`,
  ),
  '',
  `Repository readiness: ${repositoryCommunityReadinessPassed(checks) ? 'PASS' : 'BLOCKED'}`,
  '',
].join('\n');
