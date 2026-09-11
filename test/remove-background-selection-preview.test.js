import test from 'node:test';
import assert from 'node:assert/strict';

import { prepareSelectionPreview } from '../remove-background/src/selection-preview.js';

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
  assert.deepEqual(published, [{ version: 4, input: normalized, bitmap }]);
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
