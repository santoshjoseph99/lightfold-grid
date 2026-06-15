#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { formatBenchmarkMarkdown, runBenchmarkSuite } from '../src/services/benchmark.ts';

const suitePath = resolve(process.argv[2] || 'benchmarks/reference-suite.json');
const outputDirectory = resolve(process.argv[3] || 'benchmark-results');
const suite = JSON.parse(readFileSync(suitePath, 'utf8'));
const report = runBenchmarkSuite(suite);
mkdirSync(outputDirectory, { recursive: true });
const jsonPath = resolve(outputDirectory, 'latest.json');
const markdownPath = resolve(outputDirectory, 'latest.md');
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(markdownPath, formatBenchmarkMarkdown(report), 'utf8');
console.log(`Wrote ${jsonPath} and ${markdownPath} from ${dirname(suitePath)}.`);
