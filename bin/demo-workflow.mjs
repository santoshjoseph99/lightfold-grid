#!/usr/bin/env node

// Emits a workflow-creation request envelope for the Lightfold Grid demo.
// Run this from a managed terminal pane (after exiting the adapter with Ctrl+C)
// so the broker intercepts the envelope from the PTY stream.

const workflowDefinition = {
  id: `demo-slugify-${Date.now()}`,
  name: 'Slugify punctuation fix',
  goal: 'Add tests for repeated punctuation and update slugify so punctuation is removed, repeated separators collapse, and empty input returns an empty string.',
  tasks: [
    {
      id: 'build',
      owner: 'Pane-B',
      goal: 'Update slugify.js so punctuation is removed, repeated separators collapse to a single hyphen, and empty input returns an empty string. Add tests for repeated punctuation in slugify.test.js.',
      requiredCapabilities: ['coding'],
      requiredTools: ['npm'],
    },
    {
      id: 'test',
      owner: 'Pane-C',
      goal: 'Run npm test and verify that all tests pass, including the new punctuation and empty-input tests.',
      dependencies: ['build'],
      requiredCapabilities: ['testing'],
      requiredTools: ['npm'],
    },
    {
      id: 'review',
      owner: 'Pane-D',
      goal: 'Review the slugify changes for correctness, regressions, and missing test coverage. Return approval only if the evidence supports it.',
      dependencies: ['test'],
      requiredCapabilities: ['review'],
    },
  ],
};

const envelope = {
  protocolVersion: 1,
  to: 'broker',
  kind: 'request',
  payload: { data: { workflowDefinition } },
  attempt: 1,
};

process.stdout.write(`[[STARLIGHT-MSG]]${JSON.stringify(envelope)}[[END]]\n`);
