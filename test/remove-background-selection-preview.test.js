import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSelectionPreparationQueue,
  prepareSelectionPreview,
} from '../remove-background/src/selection-preview.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('valid selection publishes normalized preview input and releases its bitmap', async () => {
  const file = { name: 'photo.heic' };
  const normalized = { name: 'photo.png' };
  let closed = false;
  const bitmap = {
    width: 320,
    height: 240,
    close() {
      closed = true;
    },
  };
  const published = [];

  const result = await prepareSelectionPreview({
    file,
    version: 4,
    isCurrent: (version) => version === 4,
    normalize: async (candidate) => {
      assert.equal(candidate, file);
      return normalized;
    },
    decodeValidated: async (candidate) => {
      assert.equal(candidate, normalized);
      return bitmap;
    },
    publish: (prepared) => published.push(prepared),
  });

  assert.equal(result, normalized);
  assert.deepEqual(published, [
    {
      version: 4,
      input: normalized,
      bitmap,
      originalWidth: 320,
      originalHeight: 240,
      processedWidth: 320,
      processedHeight: 240,
      optimized: false,
    },
  ]);
  assert.equal(closed, true);
});

test('stale selection cannot publish after a newer file owns the preview', async () => {
  const firstDecode = deferred();
  const secondDecode = deferred();
  let currentVersion = 1;
  const published = [];
  const closed = [];
  const bitmap = (name) => ({
    name,
    width: 2,
    height: 2,
    close() {
      closed.push(name);
    },
  });
  const decodeValidated = (input) =>
    input.name === 'first.png' ? firstDecode.promise : secondDecode.promise;
  const options = {
    isCurrent: (version) => version === currentVersion,
    normalize: async (file) => ({ name: `${file.name}.png` }),
    decodeValidated,
    publish: ({ version, input, bitmap: decoded }) =>
      published.push({ version, input: input.name, bitmap: decoded.name }),
  };

  const first = prepareSelectionPreview({
    ...options,
    file: { name: 'first' },
    version: 1,
  });
  await Promise.resolve();
  currentVersion = 2;
  const second = prepareSelectionPreview({
    ...options,
    file: { name: 'second' },
    version: 2,
  });

  secondDecode.resolve(bitmap('second'));
  assert.equal((await second).name, 'second.png');
  firstDecode.resolve(bitmap('first'));
  assert.equal(await first, null);

  assert.deepEqual(published, [
    { version: 2, input: 'second.png', bitmap: 'second' },
  ]);
  assert.deepEqual(closed.sort(), ['first', 'second']);
});

test('decode errors do not publish an inference-ready input', async () => {
  const published = [];
  await assert.rejects(
    prepareSelectionPreview({
      file: { name: 'broken.png' },
      version: 1,
      isCurrent: () => true,
      normalize: async (file) => file,
      decodeValidated: async () => {
        throw new Error('无法解码图片，请选择有效的图片文件');
      },
      publish: (prepared) => published.push(prepared),
    }),
    /无法解码图片/,
  );
  assert.deepEqual(published, []);
});

test('4000x3000 selection publishes processed input and dimensions', async () => {
  const original = { name: 'camera.jpg', type: 'image/jpeg' };
  const processed = { name: 'camera.jpg', type: 'image/jpeg' };
  const originalBitmap = { width: 4000, height: 3000 };
  const processedBitmap = { width: 3265, height: 2449 };
  const published = [];

  const result = await prepareSelectionPreview({
    file: original,
    version: 7,
    isCurrent: () => true,
    normalize: async (file) => file,
    decodeValidated: async () => originalBitmap,
    preprocess: async ({ input, bitmap }) => {
      assert.equal(input, original);
      assert.equal(bitmap, originalBitmap);
      return {
        input: processed,
        bitmap: processedBitmap,
        originalWidth: 4000,
        originalHeight: 3000,
        processedWidth: 3265,
        processedHeight: 2449,
        optimized: true,
      };
    },
    publish: (value) => published.push(value),
  });

  assert.equal(result, processed);
  assert.equal(published[0].input, processed);
  assert.equal(published[0].bitmap, processedBitmap);
  assert.equal(published[0].optimized, true);
  assert.equal(published[0].originalWidth, 4000);
  assert.equal(published[0].processedWidth, 3265);
});

test('stale replacement after resize closes original and processed bitmaps', async () => {
  const resize = deferred();
  const resizeStarted = deferred();
  let current = true;
  const closed = [];
  const originalBitmap = {
    width: 4000,
    height: 3000,
    close: () => closed.push('original'),
  };
  const processedBitmap = {
    width: 3265,
    height: 2449,
    close: () => closed.push('processed'),
  };
  const published = [];
  const pending = prepareSelectionPreview({
    file: { name: 'old.jpg' },
    version: 1,
    isCurrent: () => current,
    normalize: async (file) => file,
    decodeValidated: async () => originalBitmap,
    preprocess: async () => {
      resizeStarted.resolve();
      return resize.promise;
    },
    publish: (value) => published.push(value),
  });
  await resizeStarted.promise;
  current = false;
  resize.resolve({
    input: { name: 'old.jpg' },
    bitmap: processedBitmap,
    originalWidth: 4000,
    originalHeight: 3000,
    processedWidth: 3265,
    processedHeight: 2449,
    optimized: true,
  });

  assert.equal(await pending, null);
  assert.deepEqual(published, []);
  assert.deepEqual(closed.sort(), ['original', 'processed']);
});

test('rapid replacements serialize preparation and supersede intermediate queued selections', async () => {
  const queue = createSelectionPreparationQueue();
  const gates = new Map();
  const started = [];
  const published = [];
  let currentVersion = 1;
  let active = 0;
  let maxActive = 0;
  const options = (version) => ({
    file: { name: `${version}.jpg` },
    version,
    isCurrent: (candidate) => candidate === currentVersion,
    normalize: async (file) => file,
    decodeValidated: async (file) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      started.push(file.name);
      const gate = deferred();
      gates.set(file.name, gate);
      await gate.promise;
      active -= 1;
      return { width: 2, height: 2, close() {} };
    },
    publish: ({ version: publishedVersion }) =>
      published.push(publishedVersion),
  });

  const first = queue.prepare(options(1));
  await Promise.resolve();
  currentVersion = 2;
  const second = queue.prepare(options(2));
  currentVersion = 3;
  const third = queue.prepare(options(3));

  assert.equal(await second, null);
  assert.deepEqual(started, ['1.jpg']);
  gates.get('1.jpg').resolve();
  assert.equal(await first, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ['1.jpg', '3.jpg']);
  gates.get('3.jpg').resolve();
  assert.equal((await third).name, '3.jpg');
  assert.equal(maxActive, 1);
  assert.deepEqual(published, [3]);
});
