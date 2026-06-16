#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
let repository;
let branch = 'main';
let commit;
let outputPath = 'hosted-validation/latest.json';
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === '--repo') repository = args[++index];
  else if (argument === '--branch') branch = args[++index];
  else if (argument === '--commit') commit = args[++index];
  else if (argument === '--output') outputPath = args[++index];
  else throw new Error(`Unknown argument: ${argument}`);
}

const run = (command, commandArgs) => {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return result.stdout.trim();
};

repository ||= run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
commit ||= run('git', ['rev-parse', 'HEAD']);

const runJson = run('gh', [
  'run',
  'list',
  '--repo',
  repository,
  '--branch',
  branch,
  '--commit',
  commit,
  '--limit',
  '50',
  '--json',
  'databaseId,workflowName,event,headBranch,headSha,status,conclusion,url,createdAt,updatedAt',
]);
const runs = JSON.parse(runJson);
const withJobs = runs.map((workflowRun) => {
  const jobJson = run('gh', [
    'api',
    `repos/${repository}/actions/runs/${workflowRun.databaseId}/jobs`,
    '--jq',
    '.jobs | map({name,status,conclusion,runnerName:.runner_name,runnerOs:.runner_os,url:.html_url})',
  ]);
  return { ...workflowRun, jobs: JSON.parse(jobJson) };
});

const evidence = {
  schemaVersion: 1,
  repository,
  branch,
  commit,
  collectedAt: new Date().toISOString(),
  source: 'github-actions',
  runs: withJobs,
};
const absoluteOutput = resolve(outputPath);
mkdirSync(dirname(absoluteOutput), { recursive: true });
writeFileSync(absoluteOutput, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(`Wrote hosted validation evidence to ${absoluteOutput}.`);
