import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTopologyConnections,
  buildWorkspacePreset,
  TOPOLOGY_PRESETS,
} from '../src/services/workspacePresets.ts';

test('local Ollama wheel creates a hub and three safe specialist spokes', () => {
  const preset = buildWorkspacePreset({
    provider: 'ollama',
    model: 'gemma4-32k:latest',
    topology: 'wheel',
  });
  assert.deepEqual(preset.paneIds, ['Pane-A', 'Pane-B', 'Pane-C', 'Pane-D']);
  assert.equal(preset.agentConfigs['Pane-A'].agentName, 'Orchestrator');
  assert.equal(preset.agentConfigs['Pane-B'].agentName, 'Builder');
  assert.equal(preset.agentConfigs['Pane-A'].cliCommand, 'ollama run');
  assert.equal(preset.agentConfigs['Pane-A'].selectedModel, 'gemma4-32k:latest');
  assert.equal(Object.values(preset.agentConfigs).every((agent) => agent.yoloMode === false), true);
  assert.deepEqual(preset.connections['Pane-A'], ['Pane-B', 'Pane-C', 'Pane-D']);
  assert.deepEqual(preset.connections['Pane-B'], ['Pane-A']);
});

test('role presets include the requested onboarding roles and embedded instructions', () => {
  const roles = new Set(
    Object.keys(TOPOLOGY_PRESETS).flatMap((topology) =>
      TOPOLOGY_PRESETS[topology as keyof typeof TOPOLOGY_PRESETS].roles
    ),
  );
  assert.deepEqual([...roles].sort(), ['builder', 'orchestrator', 'planner', 'release', 'reviewer', 'tester']);
  const preset = buildWorkspacePreset({ provider: 'gemini', model: 'auto', topology: 'pipeline' });
  assert.equal(Object.values(preset.agentConfigs).every((agent) => agent.promptContent.length > 20), true);
});

test('topology presets create explicit solo, pipeline, and review-loop routes', () => {
  assert.deepEqual(buildTopologyConnections('solo', ['A']), { A: [] });
  assert.deepEqual(buildTopologyConnections('pipeline', ['A', 'B', 'C']), {
    A: ['B'],
    B: ['C'],
    C: [],
  });
  assert.deepEqual(buildTopologyConnections('review-loop', ['A', 'B', 'C', 'D']), {
    A: ['B'],
    B: ['C'],
    C: ['D'],
    D: ['A', 'B'],
  });
});

test('custom CLI presets require callers to supply the command', () => {
  const empty = buildWorkspacePreset({ provider: 'custom', model: 'custom', topology: 'solo' });
  const configured = buildWorkspacePreset({
    provider: 'custom',
    model: 'strong',
    topology: 'solo',
    customCommand: 'my-agent',
  });
  assert.equal(empty.agentConfigs['Pane-A'].cliCommand, '');
  assert.equal(configured.agentConfigs['Pane-A'].cliCommand, 'my-agent');
});

test('mixed preset keeps coordination and testing local while escalating build and review', () => {
  const preset = buildWorkspacePreset({
    provider: 'mixed',
    model: 'gemma4-32k:latest',
    topology: 'wheel',
  });
  assert.equal(preset.agentConfigs['Pane-A'].cliCommand, 'ollama run');
  assert.equal(preset.agentConfigs['Pane-B'].cliCommand, 'gemini');
  assert.equal(preset.agentConfigs['Pane-C'].cliCommand, 'ollama run');
  assert.equal(preset.agentConfigs['Pane-D'].cliCommand, 'gemini');
  assert.equal(preset.agentConfigs['Pane-B'].selectedModel, 'auto');
});
