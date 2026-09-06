import test from 'node:test';
import assert from 'node:assert/strict';
import { findChromiumExecutable } from '../corresponding-source/rebuild/chromium-executable.mjs';

test('Chromium discovery prefers the CHROMIUM environment override', () => {
  assert.equal(findChromiumExecutable({ CHROMIUM: '/custom/chrome' }, () => false), '/custom/chrome');
});

test('Chromium discovery checks portable common executable paths', () => {
  const visited = [];
  const found = findChromiumExecutable({}, (candidate) => {
    visited.push(candidate);
    return candidate === '/usr/bin/chromium';
  });
  assert.equal(found, '/usr/bin/chromium');
  assert.ok(visited.includes('/snap/bin/chromium'));
});

test('Chromium discovery fails with an actionable fallback message', () => {
  assert.throws(
    () => findChromiumExecutable({}, () => false),
    /CHROMIUM.*Chromium\/Chrome executable/,
  );
});
