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

test('transparent PNG bytes mislabeled JPEG are resized through PNG with a matching filename', async () => {
  const { canvas, draws } = fakeCanvas(
    new Blob(['png'], { type: 'image/png' }),
  );
  const decoded = { width: 3265, height: 2449, close() {} };
  const input = new File(
    [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])],
    'alpha-camera.jpg',
    { type: 'image/jpeg', lastModified: 123 },
  );
  const result = await preprocessRemovalInput({
    input,
    bitmap: { width: 4000, height: 3000 },
    createCanvas: () => canvas,
    decode: async (file) => {
      assert.equal(file.name, 'alpha-camera.png');
      assert.equal(file.type, 'image/png');
      return decoded;
    },
  });

  assert.equal(canvas.encodedType, 'image/png');
  assert.deepEqual(draws[0].slice(1), [0, 0, 3265, 2449]);
  assert.equal(result.input.name, 'alpha-camera.png');
  assert.equal(result.input.type, 'image/png');
  assert.equal(result.bitmap, decoded);
  assert.equal(result.optimized, true);
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
});

test('WebP, AVIF, HEIC-normalized PNG, and ambiguous bytes use PNG names', async () => {
  const cases = [
    {
      bytes: [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80],
      name: 'alpha.camera.webp',
      type: 'image/jpeg',
      expectedName: 'alpha.camera.png',
    },
    {
      bytes: [0, 0, 0, 24, 102, 116, 121, 112, 97, 118, 105, 102],
      name: 'alpha.avif',
      type: 'image/jpeg',
      expectedName: 'alpha.png',
    },
    {
      bytes: [137, 80, 78, 71, 13, 10, 26, 10],
      name: 'camera.png',
      type: 'image/png',
      expectedName: 'camera.png',
    },
    {
      bytes: [255, 216, 255, 0],
      name: 'ambiguous.jpeg',
      type: 'image/jpeg',
      expectedName: 'ambiguous.png',
    },
    {
      bytes: [255, 216, 0, 224],
      name: 'broken.jpg',
      type: 'image/jpeg',
      expectedName: 'broken.png',
    },
  ];

  for (const candidate of cases) {
    const fake = fakeCanvas(new Blob(['png'], { type: 'image/png' }));
    const input = new File([Uint8Array.from(candidate.bytes)], candidate.name, {
      type: candidate.type,
    });
    const result = await preprocessRemovalInput({
      input,
      bitmap: { width: 4000, height: 3000 },
      createCanvas: () => fake.canvas,
      decode: async (file) => ({
        width: 3265,
        height: 2449,
        type: file.type,
        close() {},
      }),
    });
    assert.equal(fake.canvas.encodedType, 'image/png', candidate.name);
    assert.equal(result.input.type, 'image/png', candidate.name);
    assert.equal(result.input.name, candidate.expectedName, candidate.name);
  }
});

test('true JPEG signatures remain JPEG and normalize the extension', async () => {
  for (const marker of [0xe0, 0xe1, 0xdb, 0xc0, 0xfe]) {
    const fake = fakeCanvas(new Blob(['jpg'], { type: 'image/jpeg' }));
    const input = new File(
      [Uint8Array.from([0xff, 0xd8, 0xff, marker, 0, 16])],
      'portrait.source.png',
      { type: 'application/octet-stream' },
    );
    const result = await preprocessRemovalInput({
      input,
      bitmap: { width: 3000, height: 4000 },
      createCanvas: () => fake.canvas,
      decode: async () => ({ width: 2449, height: 3265, close() {} }),
    });
    assert.equal(fake.canvas.encodedType, 'image/jpeg');
    assert.equal(result.input.type, 'image/jpeg');
    assert.equal(result.input.name, 'portrait.source.jpg');
    assert.equal(result.originalWidth, 3000);
    assert.equal(result.originalHeight, 4000);
    assert.equal(result.processedWidth, 2449);
    assert.equal(result.processedHeight, 3265);
  }
});

test('canvas backing storage is cleared when signature reading fails', async () => {
  const fake = fakeCanvas(new Blob(['unused']));
  await assert.rejects(
    preprocessRemovalInput({
      input: {
        name: 'stale.jpg',
        slice() {
          return {
            arrayBuffer: async () => Promise.reject(new Error('stale read')),
          };
        },
      },
      bitmap: { width: 4000, height: 3000 },
      createCanvas: () => fake.canvas,
    }),
    /stale read/,
  );
  assert.equal(fake.canvas.width, 0);
  assert.equal(fake.canvas.height, 0);
});
