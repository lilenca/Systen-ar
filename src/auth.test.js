import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLogin, readSession, clearSession } from './auth.js';

test('validateLogin rejects empty form', () => {
  assert.equal(validateLogin({ username: '', password: '' }), false);
});

test('validateLogin accepts only valid admin credentials', () => {
  assert.equal(validateLogin({ username: 'admin', password: '203630' }), true);
  assert.equal(validateLogin({ username: 'admin', password: 'wrong' }), false);
});

test('readSession rejects stale or missing session', () => {
  clearSession();
  assert.equal(readSession(), false);
});
