import test from 'node:test';
import assert from 'node:assert/strict';

import { preprocessRemovalInput } from '../remove-background/src/preprocess-input.js';

function fakeCanvas(blob) {
  const draws = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        drawImage(...args) {
          draws.push(args);
        },
      };
    },
    toBlob(callback, type) {
      canvas.encodedType = type;
      callback(blob);
    },
  };
  return { canvas, draws };
}

test('transparent camera input is resized through PNG and keeps its filename', async () => {
  const { canvas, draws } = fakeCanvas(
    new Blob(['png'], { type: 'image/png' }),
  );
  const decoded = { width: 3265, height: 2449, close() {} };
  const result = await preprocessRemovalInput({
    input: { name: 'alpha.png', type: 'image/png', lastModified: 123 },
    bitmap: { width: 4000, height: 3000 },
    createCanvas: () => canvas,
    decode: async (file) => {
      assert.equal(file.name, 'alpha.png');
      assert.equal(file.type, 'image/png');
      return decoded;
    },
  });

  assert.equal(canvas.encodedType, 'image/png');
  assert.deepEqual(draws[0].slice(1), [0, 0, 3265, 2449]);
  assert.equal(result.input.name, 'alpha.png');
  assert.equal(result.input.type, 'image/png');
  assert.equal(result.bitmap, decoded);
  assert.equal(result.optimized, true);
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
});

test('non-JPEG formats use PNG so possible transparency is preserved', async () => {
  for (const type of ['image/png', 'image/webp', 'image/avif']) {
    const fake = fakeCanvas(new Blob(['png'], { type: 'image/png' }));
    const result = await preprocessRemovalInput({
      input: { name: 'alpha-image', type },
      bitmap: { width: 4000, height: 3000 },
      createCanvas: () => fake.canvas,
      decode: async (file) => ({
        width: 3265,
        height: 2449,
        type: file.type,
        close() {},
      }),
    });
    assert.equal(fake.canvas.encodedType, 'image/png');
    assert.equal(result.input.type, 'image/png');
  }
});

test('EXIF-oriented decoded bitmap dimensions drive the processed dimensions', async () => {
  const { canvas } = fakeCanvas(new Blob(['jpg'], { type: 'image/jpeg' }));
  const result = await preprocessRemovalInput({
    input: { name: 'portrait.jpg', type: 'image/jpeg' },
    bitmap: { width: 3000, height: 4000 },
    createCanvas: () => canvas,
    decode: async () => ({ width: 2449, height: 3265, close() {} }),
  });
  assert.equal(result.originalWidth, 3000);
  assert.equal(result.originalHeight, 4000);
  assert.equal(result.processedWidth, 2449);
  assert.equal(result.processedHeight, 3265);
});
