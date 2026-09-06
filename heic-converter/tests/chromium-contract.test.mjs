import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Chromium acceptance measures the downloadable blob instead of a constant', async () => {
  const source = await readFile(new URL('chromium.mjs', import.meta.url), 'utf8');
  const inspectResult = source.match(/async function inspectResult[\s\S]*?\n}\n/)?.[0];
  assert.ok(inspectResult, 'inspectResult helper missing');
  assert.doesNotMatch(inspectResult, /size\s*:\s*1\b/);
  assert.match(inspectResult, /outputBlobSizes\.get\(image\.src\)/);
  assert.match(source, /URL\.createObjectURL=.*blob\.size/);
});
