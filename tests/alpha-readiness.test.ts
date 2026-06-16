import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateAlphaReadiness,
  formatAlphaReadinessMarkdown,
  repositoryReadinessPassed,
} from '../src/services/alphaReadiness.ts';

const readyInput = {
  packageJson: { version: '0.1.0-alpha.1', license: 'Apache-2.0' },
  files: {
    '.github/workflows/ci.yml': 'ubuntu-latest macos-latest windows-latest npm test test:integration npm run build native:smoke benchmark:reference benchmark:live:contract release:signing-readiness hosted:validation',
    '.github/workflows/release.yml': 'native:smoke release:signing-readiness',
    'LICENSE': 'license',
    'CONTRIBUTING.md': 'contributing',
    'CODE_OF_CONDUCT.md': 'conduct',
    'GOVERNANCE.md': 'governance',
    'SECURITY.md': 'not a sandbox explicit approval YOLO',
    'SUPPORT.md': 'support',
    'KNOWN_LIMITATIONS.md': 'limitations',
    'SOURCE_PROVENANCE.md': 'provenance',
    'README.md': 'experimental developer alpha KNOWN_LIMITATIONS.md',
    'RELEASE_SIGNING.md': 'MAC_CSC_LINK WIN_CSC_LINK',
    'HOSTED_VALIDATION.md': 'hosted:collect',
    'BENCHMARKS.md': 'benchmark:live:validate',
    'benchmarks/live-example/campaign.json': '{}',
    'benchmark-results/latest.json': '{}',
    'hosted-validation/example.json': '{}',
    'tests/security-policy.test.ts': 'requiresApproval yoloMode',
    'tests/worktree.test.ts': 'approveReview',
    'tests/observability.test.ts': 'diagnostic exports recursively redact secrets realistic provider and registry credentials',
  },
};

test('repository readiness passes while external blockers remain explicit', () => {
  const checks = evaluateAlphaReadiness(readyInput);
  assert.equal(repositoryReadinessPassed(checks), true);
  assert.equal(checks.filter((check) => check.external && check.status === 'block').length, 5);
  assert.match(formatAlphaReadinessMarkdown(checks), /Repository readiness: PASS/);
});

test('missing repository evidence blocks alpha readiness', () => {
  const checks = evaluateAlphaReadiness({
    ...readyInput,
    files: { ...readyInput.files, 'KNOWN_LIMITATIONS.md': '' },
  });
  assert.equal(repositoryReadinessPassed(checks), false);
  assert.equal(checks.find((check) => check.id === 'known-limitations')?.status, 'block');
});
