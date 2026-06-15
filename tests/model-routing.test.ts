import assert from 'node:assert/strict';
import test from 'node:test';
import { routeTaskToModel, type AgentModelProfile } from '../src/services/modelRouting.ts';

const profile = (overrides: Partial<AgentModelProfile>): AgentModelProfile => ({
  agentId: 'local-small',
  model: 'small',
  privacy: 'local',
  capabilityTier: 2,
  contextWindow: 32_000,
  toolSupport: true,
  inputCostPerMillionTokens: 0,
  outputCostPerMillionTokens: 0,
  expectedLatencyMs: 500,
  capabilities: ['coding'],
  tools: ['git'],
  ...overrides,
});

test('selects the least expensive model satisfying task constraints', () => {
  const decision = routeTaskToModel({
    profiles: [
      profile({}),
      profile({ agentId: 'cloud-strong', model: 'strong', privacy: 'cloud', capabilityTier: 5, inputCostPerMillionTokens: 4, outputCostPerMillionTokens: 12 }),
    ],
    constraints: { estimatedInputTokens: 10_000, estimatedOutputTokens: 2_000 },
    requiredCapabilities: ['coding'],
    requiredTools: ['git'],
    now: () => 100,
  });
  assert.equal(decision.selectedAgentId, 'local-small');
  assert.equal(decision.estimatedCostUsd, 0);
  assert.equal(decision.strongestModelCostUsd, 0.064);
  assert.equal(decision.estimatedSavingsUsd, 0.064);
  assert.equal(decision.evaluatedAt, 100);
});

test('enforces local-only, capability, context, tool, and cost constraints', () => {
  assert.throws(() => routeTaskToModel({
    profiles: [
      profile({ contextWindow: 8_000 }),
      profile({ agentId: 'cloud', privacy: 'cloud', capabilityTier: 5, contextWindow: 128_000 }),
    ],
    constraints: { localOnly: true, minCapabilityTier: 3, minContextWindow: 32_000, maxEstimatedCostUsd: 0 },
    requiredTools: ['npm'],
  }), /No model satisfies task routing constraints/);
});

test('ordered fallbacks escalate without returning to attempted owners', () => {
  const profiles = [
    profile({ agentId: 'local-small' }),
    profile({ agentId: 'local-large', model: 'large', capabilityTier: 4 }),
    profile({ agentId: 'cloud', model: 'strong', privacy: 'cloud', capabilityTier: 5 }),
  ];
  const decision = routeTaskToModel({
    profiles,
    constraints: { fallbackOwners: ['local-small', 'local-large', 'cloud'] },
    previousOwners: ['local-small'],
  });
  assert.equal(decision.selectedAgentId, 'local-large');
  assert.equal(decision.escalation, 1);
  assert.match(decision.reason, /fallback 2/);
});

test('rejects adapters that cannot execute required tools', () => {
  assert.throws(() => routeTaskToModel({
    profiles: [profile({ toolSupport: false, tools: ['git'] })],
    requiredTools: ['git'],
  }), /adapter does not support tools/);
});
