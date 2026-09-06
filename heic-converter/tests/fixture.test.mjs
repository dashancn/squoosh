import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const fixtureUrl = new URL('fixtures/libheif-example.heic', import.meta.url);
const provenanceUrl = new URL('fixtures/README.md', import.meta.url);

test('real HEIC fixture is checkout-local, pinned, licensed, and byte-stable', async () => {
  const bytes = await readFile(fixtureUrl);
  const provenance = await readFile(provenanceUrl, 'utf8');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '7f8b363e4936c0666a25f64f3a92fda10bd8e5453be4592530b65a55dd98f3f2');
  assert.equal(bytes.subarray(8, 12).toString(), 'mif1');
  assert.match(provenance, /2f3bb8e48c24ea42a0dbc6fc180f44f0d745d811/);
  assert.match(provenance, /MIT License/);
  assert.match(provenance, /7f8b363e4936c0666a25f64f3a92fda10bd8e5453be4592530b65a55dd98f3f2/);
});
