import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { formatBenchmarkMarkdown, runBenchmarkSuite, validateBenchmarkSuite } from '../src/services/benchmark.ts';
import type { BenchmarkSuite } from '../src/services/benchmark.ts';

const here = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(readFileSync(join(here, '..', 'benchmarks', 'reference-suite.json'), 'utf8')) as BenchmarkSuite;

test('reference benchmark covers required task categories and configurations', () => {
  validateBenchmarkSuite(suite);
  assert.deepEqual(new Set(suite.tasks.map((task) => task.category)), new Set([
    'specification', 'coding', 'testing', 'review', 'debugging', 'repository-analysis',
  ]));
  assert.deepEqual(suite.configurations.map((configuration) => configuration.id), [
    'strong-everywhere', 'mixed-model', 'local-only',
  ]);
});

test('reference benchmark reports reproducible metrics and passes its alpha threshold', () => {
  const report = runBenchmarkSuite(suite);
  const strong = report.results.find((result) => result.configurationId === 'strong-everywhere')!;
  const mixed = report.results.find((result) => result.configurationId === 'mixed-model')!;
  assert.equal(strong.validationPassRate, 1);
  assert.equal(mixed.validationPassRate, 1);
  assert.ok(mixed.estimatedCostUsd < strong.estimatedCostUsd);
  assert.equal(report.comparison.passesAlphaThreshold, true);
  assert.equal(report.generatedAt, suite.referenceGeneratedAt);
  assert.match(formatBenchmarkMarkdown(report), /Reference alpha threshold: PASS/);
});

test('benchmark validation rejects incomplete configuration evidence', () => {
  assert.throws(() => validateBenchmarkSuite({
    ...suite,
    configurations: [{ id: 'broken', label: 'Broken', assignments: {} }],
  }), /no valid model/);
  assert.throws(() => validateBenchmarkSuite({
    ...suite,
    successThreshold: { ...suite.successThreshold, minimumEstimatedCostReduction: 2 },
  }), /between zero and one/);
});
