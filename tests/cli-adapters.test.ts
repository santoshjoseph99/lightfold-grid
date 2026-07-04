import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAdapterLaunchPlan,
  CLI_ADAPTERS,
  discoverAdapterCapabilities,
  inferAdapterId,
} from '../src/services/cliAdapters.ts';

test('provider adapters build tested launch templates without UI substring logic', () => {
  assert.equal(
    buildAdapterLaunchPlan({ adapterId: 'ollama-api', cliCommand: 'ollama run', selectedModel: 'gemma4' }, 'node "adapter.mjs"').command,
    'node "adapter.mjs" --model "gemma4"',
  );
  assert.equal(
    buildAdapterLaunchPlan({ adapterId: 'ag-cli', cliCommand: 'agy', selectedModel: 'pro', promptPath: '/tmp/prompt.md' }).command,
    'agy --model "pro"',
  );
  assert.equal(
    buildAdapterLaunchPlan({ adapterId: 'copilot-cli', cliCommand: 'copilot --model existing', selectedModel: 'other' }).command,
    'copilot --model existing',
  );
  assert.equal(
    buildAdapterLaunchPlan({ adapterId: 'ag-cli', cliCommand: 'agy --model=existing --dangerously-skip-permissions', selectedModel: 'other', yoloMode: true }).command,
    'agy --model=existing --dangerously-skip-permissions',
  );
  assert.equal(
    buildAdapterLaunchPlan({ adapterId: 'custom', cliCommand: 'agent', selectedModel: 'auto', yoloMode: true }).command,
    'agent',
  );
});

test('adapter registry exposes lifecycle, prompt, privacy, and capability discovery', () => {
  assert.equal(CLI_ADAPTERS['ollama-api'].lifecycle, 'adapter');
  assert.equal(CLI_ADAPTERS['ag-cli'].promptDelivery, 'stdin');
  assert.equal(inferAdapterId('ollama run gemma4'), 'ollama-cli');
  assert.deepEqual(discoverAdapterCapabilities({
    adapterId: 'ollama-api',
    cliCommand: 'ollama run',
    selectedModel: 'gemma4',
  }), {
    adapterId: 'ollama-api',
    privacy: 'local',
    lifecycle: 'adapter',
    promptDelivery: 'stdin',
    model: 'gemma4',
    toolSupport: true,
    contextWindow: undefined,
  });
});

test('interactive CLI adapters receive the generated contract through stdin', () => {
  const plan = buildAdapterLaunchPlan({
    adapterId: 'ag-cli',
    cliCommand: 'agy',
    selectedModel: 'auto',
    promptPath: '/tmp/role.md',
  });
  assert.equal(plan.injectPrompt, true);
});
