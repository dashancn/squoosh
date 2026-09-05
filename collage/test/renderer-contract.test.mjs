import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('renderer decodes Blob inputs sequentially, paints background, and exports PNG', async () => {
  const source = await read('src/renderer.mjs');
  assert.match(source, /for\s*\([^)]*of blobs/);
  assert.match(source, /await createImageBitmap/);
  assert.doesNotMatch(source, /Promise\.all\s*\(\s*blobs\.map/);
  assert.match(source, /fillStyle/);
  assert.match(source, /fillRect/);
  assert.match(source, /drawImage/);
  assert.match(source, /canvas\.toBlob/);
  assert.match(source, /image\/png/);
  assert.match(source, /bitmap\.close/);
  assert.match(source, /focal/);
  assert.match(source, /sourceX/);
  assert.match(source, /sourceY/);
});

test('cover transforms zoom and focal offsets while keeping the source rectangle inside the image', async () => {
  const { calculateCoverCrop } = await import('../src/renderer.mjs');
  assert.deepEqual(calculateCoverCrop({ width: 1000, height: 500 }, { width: 200, height: 200 }, { zoom: 1, x: 0.5, y: 0.5 }), {
    sourceX: 250, sourceY: 0, sourceWidth: 500, sourceHeight: 500,
  });
  assert.deepEqual(calculateCoverCrop({ width: 1000, height: 500 }, { width: 200, height: 200 }, { zoom: 2, x: 1, y: -1 }), {
    sourceX: 750, sourceY: 0, sourceWidth: 250, sourceHeight: 250,
  });
});

test('renderer rejects missing or invalid image inputs', async () => {
  const { createCollage } = await import('../src/renderer.mjs');
  await assert.rejects(createCollage([], {}), /At least one image Blob/);
  await assert.rejects(createCollage(['not-a-blob'], {}), /At least one image Blob/);
});
