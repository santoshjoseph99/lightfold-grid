import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  evaluateHostedValidation,
  formatHostedValidationMarkdown,
  hostedValidationPassed,
  validateHostedValidationEvidence,
} from '../src/services/hostedValidation.ts';
import type { HostedValidationEvidence } from '../src/services/hostedValidation.ts';

const evidence = JSON.parse(
  readFileSync(new URL('../hosted-validation/example.json', import.meta.url), 'utf8'),
) as HostedValidationEvidence;

test('hosted validation evidence passes for completed cross-platform CI and security runs', () => {
  validateHostedValidationEvidence(evidence);
  const checks = evaluateHostedValidation(evidence);
  assert.equal(hostedValidationPassed(checks), true);
  assert.match(formatHostedValidationMarkdown(evidence, checks), /Hosted validation: PASS/);
});

test('hosted validation blocks missing platform jobs and pending security runs', () => {
  const checks = evaluateHostedValidation({
    ...evidence,
    runs: evidence.runs.map((run) => {
      if (run.workflowName === 'CI') {
        return { ...run, jobs: run.jobs?.filter((job) => !job.name.includes('windows-latest')) };
      }
      if (run.workflowName === 'CodeQL') return { ...run, status: 'in_progress', conclusion: '' };
      return run;
    }),
  });
  assert.equal(hostedValidationPassed(checks), false);
  assert.equal(checks.find((check) => check.id === 'ci-windows')?.status, 'block');
  assert.equal(checks.find((check) => check.id === 'codeql-workflow')?.status, 'block');
});

test('hosted validation rejects evidence for a different branch or commit', () => {
  assert.throws(() => validateHostedValidationEvidence({
    ...evidence,
    runs: [{ ...evidence.runs[0], headSha: 'ffffffffffffffffffffffffffffffffffffffff' }],
  }), /does not match/);
});
