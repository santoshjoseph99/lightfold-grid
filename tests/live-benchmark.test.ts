import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  formatLiveBenchmarkMarkdown,
  summarizeLiveBenchmarkCampaign,
  validateLiveBenchmarkCampaign,
} from '../src/services/liveBenchmark.ts';
import type { LiveBenchmarkCampaign } from '../src/services/liveBenchmark.ts';

const campaign = JSON.parse(
  readFileSync(new URL('../benchmarks/live-example/campaign.json', import.meta.url), 'utf8'),
) as LiveBenchmarkCampaign;

test('live benchmark contract requires complete repeated and pinned evidence', () => {
  validateLiveBenchmarkCampaign(campaign);
  assert.equal(campaign.runs.length, campaign.configurations.length * campaign.tasks.length * campaign.repetitions);
  assert.throws(
    () => validateLiveBenchmarkCampaign(campaign, { requireLive: true }),
    /must have live provenance/,
  );
});

test('live benchmark summary compares validated repeated configurations', () => {
  const report = summarizeLiveBenchmarkCampaign(campaign);
  assert.equal(report.results.find((result) => result.configurationId === 'strong')?.runCount, 6);
  assert.ok(report.comparison.estimatedCostReduction > 0);
  assert.match(formatLiveBenchmarkMarkdown(report), /FIXTURE ONLY/);
});

test('live benchmark rejects missing, mismatched, and unsafe raw evidence', () => {
  assert.throws(
    () => validateLiveBenchmarkCampaign({ ...campaign, runs: campaign.runs.slice(1) }),
    /Missing live benchmark run/,
  );
  assert.throws(
    () => validateLiveBenchmarkCampaign({
      ...campaign,
      runs: campaign.runs.map((run, index) => index === 0 ? { ...run, modelId: 'local-pinned' } : run),
    }),
    /does not match its configuration assignment/,
  );
  assert.throws(
    () => validateLiveBenchmarkCampaign({
      ...campaign,
      runs: campaign.runs.map((run, index) => index === 0 ? { ...run, evidencePath: '../secret' } : run),
    }),
    /safe raw-evidence path/,
  );
  assert.throws(
    () => validateLiveBenchmarkCampaign({
      ...campaign,
      promptSets: campaign.promptSets.map((prompt) => ({ ...prompt, path: 'C:\\secret.txt' })),
    }),
    /safe artifact path/,
  );
});
