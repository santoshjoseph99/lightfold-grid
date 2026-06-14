import assert from 'node:assert/strict';
import test from 'node:test';
import { disablePersistedYoloModes } from '../src/services/securityPolicy.ts';

test('workspace persistence and loading always disable YOLO mode', () => {
  const configs = {
    Unsafe: { agentName: 'Unsafe', yoloMode: true },
    Safe: { agentName: 'Safe', yoloMode: false },
  };
  const sanitized = disablePersistedYoloModes(configs);
  assert.equal(sanitized.Unsafe.yoloMode, false);
  assert.equal(sanitized.Safe.yoloMode, false);
  assert.equal(configs.Unsafe.yoloMode, true);
  assert.notEqual(sanitized.Unsafe, configs.Unsafe);
});
