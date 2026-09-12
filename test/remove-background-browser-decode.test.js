import test from 'node:test';
import assert from 'node:assert/strict';

import { decodeBrowserImage } from '../remove-background/src/browser-image-decode.js';

function fallbackEnvironment({ bitmapFailure = true } = {}) {
  const revoked = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage() {} }),
  };
  class FakeImage {
    naturalWidth = 32;
    naturalHeight = 24;
    async decode() {}
    set src(value) {
      this._src = value;
    }
    get src() {
      return this._src;
    }
  }
  return {
    canvas,
    revoked,
    options: {
      createImageBitmap: bitmapFailure
        ? async () => {
            throw new Error('Safari bitmap failure');
          }
        : undefined,
      createImage: () => new FakeImage(),
      createCanvas: () => canvas,
      createObjectURL: () => 'blob:test',
      revokeObjectURL: (url) => revoked.push(url),
    },
  };
}

test('browser decode falls back to an owned canvas when createImageBitmap rejects', async () => {
  const env = fallbackEnvironment();
  const decoded = await decodeBrowserImage(new Blob(['image']), env.options);
  assert.equal(decoded, env.canvas);
  assert.deepEqual([decoded.width, decoded.height], [32, 24]);
  assert.deepEqual(env.revoked, ['blob:test']);
  decoded.close();
  assert.deepEqual([decoded.width, decoded.height], [0, 0]);
});

test('browser decode works when createImageBitmap is absent', async () => {
  const env = fallbackEnvironment({ bitmapFailure: false });
  const decoded = await decodeBrowserImage(new Blob(['image']), env.options);
  assert.equal(decoded, env.canvas);
  assert.deepEqual([decoded.width, decoded.height], [32, 24]);
});
