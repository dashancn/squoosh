import test from 'node:test';
import assert from 'node:assert/strict';
import { HeicWorkerClient } from '../src/heic-worker-client.mjs';
import { handleHeicWorkerMessage } from '../src/heic-worker-handler.mjs';

class FakeWorker {
  static instances = [];
  constructor(url, options) {
    this.url = String(url);
    this.options = options;
    this.messages = [];
    this.terminated = false;
    FakeWorker.instances.push(this);
  }
  postMessage(message) {
    this.messages.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data) {
    this.onmessage?.({ data });
  }
}

test('HEIC worker client creates a same-origin module worker lazily', async () => {
  FakeWorker.instances = [];
  const client = new HeicWorkerClient({
    WorkerClass: FakeWorker,
    workerUrl: new URL(
      'https://tools.example/heic-converter/src/heic-worker.mjs',
    ),
  });
  assert.equal(FakeWorker.instances.length, 0);
  const promise = client.inspect({ name: 'photo.heic' });
  const worker = FakeWorker.instances[0];
  assert.equal(
    worker.url,
    'https://tools.example/heic-converter/src/heic-worker.mjs',
  );
  assert.deepEqual(worker.options, { type: 'module', name: 'heic-decoder' });
  assert.equal(worker.messages[0].operation, 'inspect');
  worker.emit({
    id: worker.messages[0].id,
    type: 'result',
    isHeic: true,
    width: 12,
    height: 8,
  });
  assert.deepEqual(await promise, { isHeic: true, width: 12, height: 8 });
});

test('HEIC worker client relays progress and returns transferred conversion bytes', async () => {
  FakeWorker.instances = [];
  const progress = [];
  const client = new HeicWorkerClient({
    WorkerClass: FakeWorker,
    workerUrl: new URL('https://tools.example/worker.mjs'),
    onProgress: (message) => progress.push(message),
  });
  const promise = client.convert({ name: 'photo.heic' });
  const worker = FakeWorker.instances[0];
  const id = worker.messages[0].id;
  worker.emit({ id, type: 'progress', message: 'decoding' });
  worker.emit({
    id,
    type: 'result',
    buffer: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer,
    mimeType: 'image/png',
  });
  const result = await promise;
  assert.deepEqual(progress, ['decoding']);
  assert.deepEqual(
    [...new Uint8Array(result.buffer)],
    [137, 80, 78, 71, 13, 10, 26, 10],
  );
  assert.equal(result.mimeType, 'image/png');
});

test('HEIC worker client rejects non-PNG MIME and bytes from the worker', async () => {
  for (const response of [
    {
      buffer: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer,
      mimeType: 'image/jpeg',
    },
    { buffer: new Uint8Array([1, 2, 3]).buffer, mimeType: 'image/png' },
    { buffer: 'not-an-array-buffer', mimeType: 'image/png' },
  ]) {
    FakeWorker.instances = [];
    const client = new HeicWorkerClient({ WorkerClass: FakeWorker });
    const promise = client.convert({ name: 'photo.heic' });
    const worker = FakeWorker.instances[0];
    worker.emit({ id: worker.messages[0].id, type: 'result', ...response });
    await assert.rejects(promise, /PNG/);
    client.terminate();
  }
});

test('worker conversion only returns a verified image/png payload', async () => {
  const messages = [];
  await handleHeicWorkerMessage(
    {
      id: 9,
      operation: 'convert',
      file: { name: 'photo.heic', arrayBuffer: async () => new ArrayBuffer(12) },
    },
    {
      isHeicBytes: () => true,
      inspectHeic: () => ({ width: 1, height: 1 }),
      decodeHeic: async () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }),
      validateDimensions: () => {},
      createCanvas: () => ({
        width: 1,
        height: 1,
        getContext: () => ({ putImageData() {} }),
        convertToBlob: async () => ({
          type: 'image/jpeg',
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        }),
      }),
      postMessage: (message) => messages.push(message),
    },
  );
  assert.equal(messages.at(-1).type, 'error');
  assert.match(messages.at(-1).error, /PNG/);
  assert.equal(messages.some((message) => message.type === 'result'), false);
});

test('worker conversion returns transferable pixels when canvas encoding is unavailable', async () => {
  const messages = [];
  const pixels = new Uint8ClampedArray([1, 2, 3, 255]);
  await handleHeicWorkerMessage(
    {
      id: 10,
      operation: 'convert',
      width: 1,
      height: 1,
      file: { name: 'photo.heic', arrayBuffer: async () => new ArrayBuffer(12) },
    },
    {
      isHeicBytes: () => true,
      inspectHeic: () => ({ width: 1, height: 1 }),
      decodeHeic: async () => ({ width: 1, height: 1, data: pixels }),
      validateDimensions: () => {},
      createCanvas: () => null,
      postMessage: (...args) => messages.push(args),
    },
  );
  assert.equal(messages.at(-1)[0].type, 'pixels');
  assert.equal(messages.at(-1)[0].width, 1);
  assert.equal(messages.at(-1)[0].height, 1);
  assert.equal(messages.at(-1)[0].buffer, pixels.buffer);
  assert.deepEqual(messages.at(-1)[1], [pixels.buffer]);
});

test('worker rejects unsafe requested output dimensions before scaling allocation', async () => {
  const messages = [];
  const pixels = new Uint8ClampedArray(4);
  await handleHeicWorkerMessage(
    {
      id: 11,
      operation: 'convert',
      width: 100_000,
      height: 100_000,
      file: { name: 'photo.heic', arrayBuffer: async () => new ArrayBuffer(12) },
    },
    {
      isHeicBytes: () => true,
      inspectHeic: () => ({ width: 1, height: 1 }),
      decodeHeic: async () => ({ width: 1, height: 1, data: pixels }),
      validateDimensions: () => {},
      createCanvas: () => { throw new Error('must reject before canvas'); },
      postMessage: (message) => messages.push(message),
    },
  );
  assert.equal(messages.at(-1).type, 'error');
  assert.match(messages.at(-1).error, /安全限制/);
});

test('terminating the HEIC worker rejects pending work and next request uses a fresh worker', async () => {
  FakeWorker.instances = [];
  const client = new HeicWorkerClient({
    WorkerClass: FakeWorker,
    workerUrl: new URL('https://tools.example/worker.mjs'),
  });
  const stale = client.convert({ name: 'old.heic' });
  const oldWorker = FakeWorker.instances[0];
  client.terminate();
  await assert.rejects(stale, /已取消/);
  assert.equal(oldWorker.terminated, true);
  const fresh = client.inspect({ name: 'new.heic' });
  const newWorker = FakeWorker.instances[1];
  assert.notEqual(newWorker, oldWorker);
  newWorker.emit({
    id: newWorker.messages[0].id,
    type: 'result',
    isHeic: false,
  });
  assert.deepEqual(await fresh, {
    isHeic: false,
    width: undefined,
    height: undefined,
  });
});

test('worker errors reject the matching request', async () => {
  FakeWorker.instances = [];
  const client = new HeicWorkerClient({
    WorkerClass: FakeWorker,
    workerUrl: new URL('https://tools.example/worker.mjs'),
  });
  const promise = client.convert({ name: 'bad.heic' });
  const worker = FakeWorker.instances[0];
  worker.emit({
    id: worker.messages[0].id,
    type: 'error',
    error: 'decode failed',
  });
  await assert.rejects(promise, /decode failed/);
});

test('timed out HEIC work terminates the worker and rejects all pending requests', async () => {
  FakeWorker.instances = [];
  const client = new HeicWorkerClient({
    WorkerClass: FakeWorker,
    workerUrl: new URL('https://tools.example/worker.mjs'),
    timeoutMs: 5,
  });
  const first = client.convert({ name: 'slow.heic' });
  const second = client.inspect({ name: 'also-slow.heic' });
  const worker = FakeWorker.instances[0];
  await assert.rejects(first, /超时/);
  await assert.rejects(second, /超时/);
  assert.equal(worker.terminated, true);
});

test('inspect returns dimensions obtained before pixel display allocation', async () => {
  FakeWorker.instances = [];
  const client = new HeicWorkerClient({
    WorkerClass: FakeWorker,
    workerUrl: new URL('https://tools.example/worker.mjs'),
  });
  const promise = client.inspect({ name: 'photo.heic' });
  const worker = FakeWorker.instances[0];
  worker.emit({
    id: worker.messages[0].id,
    type: 'result',
    isHeic: true,
    width: 4032,
    height: 3024,
  });
  assert.deepEqual(await promise, { isHeic: true, width: 4032, height: 3024 });
});

test('worker inspect opens valid HEIC for dimensions without pixel allocation', async () => {
  const allocations = [];
  const messages = [];
  await handleHeicWorkerMessage(
    {
      id: 8,
      operation: 'inspect',
      file: { arrayBuffer: async () => new ArrayBuffer(12) },
    },
    {
      isHeicBytes: () => true,
      inspectHeic: () => ({ width: 4032, height: 3024 }),
      decodeHeic: () => {
        allocations.push('decode');
      },
      validateDimensions: () => {},
      createCanvas: () => {
        allocations.push('canvas');
      },
      postMessage: (message) => messages.push(message),
    },
  );
  assert.deepEqual(allocations, []);
  assert.deepEqual(messages, [
    { id: 8, type: 'result', isHeic: true, width: 4032, height: 3024 },
  ]);
});

test('oversized decoded dimensions are rejected before ImageData or OffscreenCanvas allocation', async () => {
  const allocations = [];
  const messages = [];
  await handleHeicWorkerMessage(
    {
      id: 7,
      operation: 'convert',
      file: { name: 'huge.heic', arrayBuffer: async () => new ArrayBuffer(12) },
    },
    {
      isHeicBytes: () => true,
      inspectHeic: () => ({ width: 1, height: 1 }),
      decodeHeic: async (_buffer, validate) => {
        validate(100_000, 100_000);
        allocations.push('ImageData');
      },
      validateDimensions: () => {
        throw new Error('图片像素尺寸过大');
      },
      createCanvas: () => {
        allocations.push('OffscreenCanvas');
      },
      postMessage: (message) => messages.push(message),
    },
  );
  assert.deepEqual(allocations, []);
  assert.equal(messages.at(-1).type, 'error');
  assert.match(messages.at(-1).error, /像素尺寸过大/);
});
