import test from 'node:test';
import assert from 'node:assert/strict';
import { HeicWorkerClient } from '../src/heic-worker-client.mjs';

class FakeWorker {
  static instances = [];
  constructor(url, options) { this.url = String(url); this.options = options; this.messages = []; this.terminated = false; FakeWorker.instances.push(this); }
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  emit(data) { this.onmessage?.({ data }); }
}

test('HEIC worker client creates a same-origin module worker lazily', async () => {
  FakeWorker.instances = [];
  const client = new HeicWorkerClient({ WorkerClass: FakeWorker, workerUrl: new URL('https://tools.example/heic-converter/src/heic-worker.mjs') });
  assert.equal(FakeWorker.instances.length, 0);
  const promise = client.inspect({ name: 'photo.heic' });
  const worker = FakeWorker.instances[0];
  assert.equal(worker.url, 'https://tools.example/heic-converter/src/heic-worker.mjs');
  assert.deepEqual(worker.options, { type: 'module', name: 'heic-decoder' });
  assert.equal(worker.messages[0].operation, 'inspect');
  worker.emit({ id: worker.messages[0].id, type: 'result', isHeic: true, width: 12, height: 8 });
  assert.deepEqual(await promise, { isHeic: true, width: 12, height: 8 });
});

test('HEIC worker client relays progress and returns transferred conversion bytes', async () => {
  FakeWorker.instances = [];
  const progress = [];
  const client = new HeicWorkerClient({ WorkerClass: FakeWorker, workerUrl: new URL('https://tools.example/worker.mjs'), onProgress: (message) => progress.push(message) });
  const promise = client.convert({ name: 'photo.heic' });
  const worker = FakeWorker.instances[0];
  const id = worker.messages[0].id;
  worker.emit({ id, type: 'progress', message: 'decoding' });
  worker.emit({ id, type: 'result', buffer: new Uint8Array([1, 2, 3]).buffer, mimeType: 'image/png' });
  const result = await promise;
  assert.deepEqual(progress, ['decoding']);
  assert.deepEqual([...new Uint8Array(result.buffer)], [1, 2, 3]);
  assert.equal(result.mimeType, 'image/png');
});

test('terminating the HEIC worker rejects pending work and next request uses a fresh worker', async () => {
  FakeWorker.instances = [];
  const client = new HeicWorkerClient({ WorkerClass: FakeWorker, workerUrl: new URL('https://tools.example/worker.mjs') });
  const stale = client.convert({ name: 'old.heic' });
  const oldWorker = FakeWorker.instances[0];
  client.terminate();
  await assert.rejects(stale, /已取消/);
  assert.equal(oldWorker.terminated, true);
  const fresh = client.inspect({ name: 'new.heic' });
  const newWorker = FakeWorker.instances[1];
  assert.notEqual(newWorker, oldWorker);
  newWorker.emit({ id: newWorker.messages[0].id, type: 'result', isHeic: false });
  assert.deepEqual(await fresh, { isHeic: false, width: undefined, height: undefined });
});

test('worker errors reject the matching request', async () => {
  FakeWorker.instances = [];
  const client = new HeicWorkerClient({ WorkerClass: FakeWorker, workerUrl: new URL('https://tools.example/worker.mjs') });
  const promise = client.convert({ name: 'bad.heic' });
  const worker = FakeWorker.instances[0];
  worker.emit({ id: worker.messages[0].id, type: 'error', error: 'decode failed' });
  await assert.rejects(promise, /decode failed/);
});

test('timed out HEIC work terminates the worker and rejects all pending requests', async () => {
  FakeWorker.instances = [];
  const client = new HeicWorkerClient({ WorkerClass: FakeWorker, workerUrl: new URL('https://tools.example/worker.mjs'), timeoutMs: 5 });
  const first = client.convert({ name: 'slow.heic' });
  const second = client.inspect({ name: 'also-slow.heic' });
  const worker = FakeWorker.instances[0];
  await assert.rejects(first, /超时/);
  await assert.rejects(second, /超时/);
  assert.equal(worker.terminated, true);
});

test('inspect returns dimensions obtained before pixel display allocation', async () => {
  FakeWorker.instances = [];
  const client = new HeicWorkerClient({ WorkerClass: FakeWorker, workerUrl: new URL('https://tools.example/worker.mjs') });
  const promise = client.inspect({ name: 'photo.heic' });
  const worker = FakeWorker.instances[0];
  worker.emit({ id: worker.messages[0].id, type: 'result', isHeic: true, width: 4032, height: 3024 });
  assert.deepEqual(await promise, { isHeic: true, width: 4032, height: 3024 });
});
