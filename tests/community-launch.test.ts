import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateCommunityReadiness,
  formatCommunityReadinessMarkdown,
  repositoryCommunityReadinessPassed,
} from '../src/services/communityLaunch.ts';

const readyInput = {
  files: {
    'PRIVATE_ALPHA.md': 'Participant Criteria Consent And Privacy Session Checklist Outcome Record Stop Conditions without maintainer intervention',
    'ROADMAP.md': 'plans work around outcomes users can demonstrate Understand What Every Agent Is Doing Complete A Safe First Workflow Spend Strong-Model Tokens Only Where They Matter Extend The Model And CLI Ecosystem Publish A Trustworthy Developer Alpha',
    '.github/labels.yml': 'name: good first issue name: adapter name: documentation name: private alpha name: security',
    '.github/ISSUE_TEMPLATE/alpha_feedback.yml': 'private alpha feedback no secrets or private repository content Demo completed without maintainer help Session observations',
    '.github/ISSUE_TEMPLATE/adapter_contribution.yml': 'adapter contribution ADAPTERS.md Conformance plan',
    '.github/workflows/ci.yml': 'npm run community:readiness',
    '.github/workflows/release.yml': 'npm run community:readiness',
  },
};

test('repository community readiness passes while real launch work remains explicit', () => {
  const checks = evaluateCommunityReadiness(readyInput);
  assert.equal(repositoryCommunityReadinessPassed(checks), true);
  assert.equal(checks.filter((check) => check.external && check.status === 'block').length, 3);
  assert.match(formatCommunityReadinessMarkdown(checks), /Repository readiness: PASS/);
});

test('missing repository evidence blocks community readiness', () => {
  const checks = evaluateCommunityReadiness({
    files: { ...readyInput.files, 'ROADMAP.md': '' },
  });
  assert.equal(repositoryCommunityReadinessPassed(checks), false);
  assert.equal(checks.find((check) => check.id === 'outcome-roadmap')?.status, 'block');
});
