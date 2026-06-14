import assert from 'node:assert/strict';
import test from 'node:test';
import { slugify } from './slugify.js';

test('slugifies ordinary titles', () => {
  assert.equal(slugify('Lightfold Grid'), 'lightfold-grid');
});
