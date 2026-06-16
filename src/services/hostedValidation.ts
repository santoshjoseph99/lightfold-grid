export type HostedValidationStatus = 'pass' | 'block';

export interface HostedValidationJob {
  name: string;
  status: string;
  conclusion: string | null;
  runnerName?: string;
  runnerOs?: string;
  url?: string;
}

export interface HostedValidationRun {
  workflowName: string;
  event: string;
  headBranch: string;
  headSha: string;
  databaseId: number;
  url: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  jobs?: HostedValidationJob[];
}

export interface HostedValidationEvidence {
  schemaVersion: 1;
  repository: string;
  branch: string;
  commit: string;
  collectedAt: string;
  source: 'github-actions';
  runs: HostedValidationRun[];
}

export interface HostedValidationCheck {
  id: string;
  label: string;
  status: HostedValidationStatus;
  detail: string;
}

const requiredCiJobs = [
  { id: 'ci-ubuntu', label: 'CI on Ubuntu', pattern: /ubuntu-latest/i },
  { id: 'ci-macos', label: 'CI on macOS', pattern: /macos-latest/i },
  { id: 'ci-windows', label: 'CI on Windows', pattern: /windows-latest/i },
];

const isTimestamp = (value: string) => Number.isFinite(Date.parse(value));
const isSuccessfulRun = (run: HostedValidationRun) => run.status === 'completed' && run.conclusion === 'success';
const runMatches = (run: HostedValidationRun, evidence: HostedValidationEvidence, workflowName: string) =>
  run.workflowName === workflowName && run.headBranch === evidence.branch && run.headSha === evidence.commit;

export const validateHostedValidationEvidence = (evidence: HostedValidationEvidence) => {
  if (evidence.schemaVersion !== 1 || evidence.source !== 'github-actions') {
    throw new Error('Hosted validation evidence requires schema version 1 and github-actions source.');
  }
  if (!/^[-\w.]+\/[-\w.]+$/.test(evidence.repository)) {
    throw new Error('Hosted validation evidence requires an owner/repository identifier.');
  }
  if (!evidence.branch?.trim() || !/^[a-f0-9]{7,40}$/i.test(evidence.commit) || !isTimestamp(evidence.collectedAt)) {
    throw new Error('Hosted validation evidence requires a branch, commit, and collection timestamp.');
  }
  const seenRuns = new Set<number>();
  evidence.runs.forEach((run) => {
    if (seenRuns.has(run.databaseId)) throw new Error(`Duplicate hosted validation run ${run.databaseId}.`);
    seenRuns.add(run.databaseId);
    if (!run.workflowName?.trim() || !run.event?.trim() || !run.url.startsWith('https://github.com/')) {
      throw new Error(`Hosted validation run ${run.databaseId} is missing workflow metadata.`);
    }
    if (run.headSha !== evidence.commit || run.headBranch !== evidence.branch) {
      throw new Error(`Hosted validation run ${run.databaseId} does not match the evidence branch and commit.`);
    }
    if (!isTimestamp(run.createdAt) || !isTimestamp(run.updatedAt)) {
      throw new Error(`Hosted validation run ${run.databaseId} has invalid timestamps.`);
    }
  });
  return evidence;
};

export const evaluateHostedValidation = (evidence: HostedValidationEvidence): HostedValidationCheck[] => {
  validateHostedValidationEvidence(evidence);
  const matchingRuns = evidence.runs.filter((run) => run.headSha === evidence.commit && run.headBranch === evidence.branch);
  const ci = matchingRuns.find((run) => runMatches(run, evidence, 'CI'));
  const codeql = matchingRuns.find((run) => runMatches(run, evidence, 'CodeQL'));
  const secretScan = matchingRuns.find((run) => runMatches(run, evidence, 'Secret Scan'));
  const ciJobs = ci?.jobs || [];

  return [
    {
      id: 'ci-workflow',
      label: 'Hosted CI workflow',
      status: ci && isSuccessfulRun(ci) ? 'pass' : 'block',
      detail: ci
        ? `CI run ${ci.databaseId} is ${ci.status}/${ci.conclusion || 'pending'}.`
        : 'No CI run was recorded for the target commit.',
    },
    ...requiredCiJobs.map((required): HostedValidationCheck => {
      const job = ciJobs.find((candidate) => required.pattern.test(candidate.name));
      return {
        id: required.id,
        label: required.label,
        status: job?.status === 'completed' && job.conclusion === 'success' ? 'pass' : 'block',
        detail: job
          ? `${job.name} is ${job.status}/${job.conclusion || 'pending'}.`
          : `No ${required.label} job was recorded for the CI run.`,
      };
    }),
    {
      id: 'codeql-workflow',
      label: 'Hosted CodeQL workflow',
      status: codeql && isSuccessfulRun(codeql) ? 'pass' : 'block',
      detail: codeql
        ? `CodeQL run ${codeql.databaseId} is ${codeql.status}/${codeql.conclusion || 'pending'}.`
        : 'No CodeQL run was recorded for the target commit.',
    },
    {
      id: 'secret-scan-workflow',
      label: 'Hosted secret scan workflow',
      status: secretScan && isSuccessfulRun(secretScan) ? 'pass' : 'block',
      detail: secretScan
        ? `Secret Scan run ${secretScan.databaseId} is ${secretScan.status}/${secretScan.conclusion || 'pending'}.`
        : 'No Secret Scan run was recorded for the target commit.',
    },
  ];
};

export const hostedValidationPassed = (checks: HostedValidationCheck[]) =>
  checks.every((check) => check.status === 'pass');

export const formatHostedValidationMarkdown = (evidence: HostedValidationEvidence, checks: HostedValidationCheck[]) => [
  '# Hosted GitHub Validation',
  '',
  `Repository: ${evidence.repository}`,
  '',
  `Branch: ${evidence.branch}`,
  '',
  `Commit: ${evidence.commit}`,
  '',
  `Collected: ${evidence.collectedAt}`,
  '',
  '| Gate | Status | Detail |',
  '| --- | --- | --- |',
  ...checks.map((check) => `| ${check.label} | ${check.status.toUpperCase()} | ${check.detail} |`),
  '',
  `Hosted validation: ${hostedValidationPassed(checks) ? 'PASS' : 'BLOCKED'}`,
  '',
].join('\n');
