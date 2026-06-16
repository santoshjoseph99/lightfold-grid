#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  evaluateHostedValidation,
  formatHostedValidationMarkdown,
  hostedValidationPassed,
} from '../src/services/hostedValidation.ts';

const evidencePath = resolve(process.argv[2] || 'hosted-validation/example.json');
const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
const checks = evaluateHostedValidation(evidence);
process.stdout.write(formatHostedValidationMarkdown(evidence, checks));
if (!hostedValidationPassed(checks)) process.exitCode = 1;
