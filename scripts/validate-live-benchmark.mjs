#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  formatLiveBenchmarkMarkdown,
  summarizeLiveBenchmarkCampaign,
  validateLiveBenchmarkCampaign,
} from '../src/services/liveBenchmark.ts';

const args = process.argv.slice(2);
let campaignArgument;
let outputArgument;
let requireLive = false;
let checkOnly = false;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === '--require-live') requireLive = true;
  else if (argument === '--check-only') checkOnly = true;
  else if (argument === '--output') {
    outputArgument = args[index + 1];
    if (!outputArgument) throw new Error('--output requires a directory.');
    index += 1;
  } else if (argument.startsWith('--')) {
    throw new Error(`Unknown option: ${argument}`);
  } else if (!campaignArgument) {
    campaignArgument = argument;
  } else {
    throw new Error(`Unexpected argument: ${argument}`);
  }
}
campaignArgument ||= 'benchmarks/live-example/campaign.json';
const campaignPath = resolve(campaignArgument);
const campaignDirectory = dirname(campaignPath);
const campaign = JSON.parse(readFileSync(campaignPath, 'utf8'));

validateLiveBenchmarkCampaign(campaign, { requireLive });
for (const prompt of campaign.promptSets) {
  const promptPath = resolve(campaignDirectory, prompt.path);
  const digest = createHash('sha256').update(readFileSync(promptPath)).digest('hex');
  if (digest !== prompt.sha256) {
    throw new Error(`Prompt-set digest mismatch for ${prompt.id}: ${prompt.path}`);
  }
}
const evidenceRecords = new Map();
for (const run of campaign.runs) {
  const evidencePath = resolve(campaignDirectory, run.evidencePath);
  const contents = readFileSync(evidencePath);
  const digest = createHash('sha256').update(contents).digest('hex');
  if (digest !== run.evidenceSha256) {
    throw new Error(`Raw evidence digest mismatch for ${run.id}: ${run.evidencePath}`);
  }
  if (!evidenceRecords.has(evidencePath)) {
    const parsed = JSON.parse(contents.toString('utf8'));
    if (!Array.isArray(parsed.records)) {
      throw new Error(`Raw evidence bundle requires a records array: ${run.evidencePath}`);
    }
    evidenceRecords.set(evidencePath, new Set(parsed.records.map((record) =>
      typeof record === 'string' ? record : record?.id,
    )));
  }
  if (!evidenceRecords.get(evidencePath).has(run.evidenceRecordId)) {
    throw new Error(`Raw evidence record ${run.evidenceRecordId} is missing from ${run.evidencePath}`);
  }
}

const report = summarizeLiveBenchmarkCampaign(campaign);
process.stdout.write(formatLiveBenchmarkMarkdown(report));
if (!checkOnly) {
  const outputDirectory = resolve(outputArgument || 'live-benchmark-results');
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(resolve(outputDirectory, `${campaign.id}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(resolve(outputDirectory, `${campaign.id}.md`), formatLiveBenchmarkMarkdown(report), 'utf8');
  console.log(`Wrote validated report to ${outputDirectory}.`);
}
