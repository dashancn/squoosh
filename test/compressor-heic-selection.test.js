import test from 'node:test';
import assert from 'node:assert/strict';

import { CompressorHeicInput } from '../src/client/initial-app/heic-input.mjs';

function ordinary(name = 'photo.jpg') {
  return {
    name,
    size: 3,
    slice: () => ({
      arrayBuffer: async () => Uint8Array.from([0xff, 0xd8, 0xff]).buffer,
    }),
  };
}
function heic(name = 'portrait.heic', size = 12) {
  const head = Uint8Array.from([
    0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
  ]);
  return {
    name,
    size,
    type: 'image/heic',
    slice: () => ({ arrayBuffer: async () => head.buffer }),
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('ordinary images pass through without creating or calling a HEIC worker', async () => {
  const opened = [];
  let created = 0;
  const input = new CompressorHeicInput({
    openFile: (file) => opened.push(file),
    createWorkerClient: () => {
      created += 1;
      throw new Error('must stay lazy');
    },
  });
  const file = ordinary();
  await input.select(file);
  assert.deepEqual(opened, [file]);
  assert.equal(created, 0);
});

test('signature-valid HEIC is inspected then lazily converted to a PNG File', async () => {
  const calls = [];
  const notices = [];
  const opened = [];
  const worker = {
    inspect: async (file) => {
      calls.push(['inspect', file.name]);
      return { isHeic: true, width: 1280, height: 854 };
    },
    convert: async (file) => {
      calls.push(['convert', file.name]);
      return {
        buffer: Uint8Array.from([137, 80, 78, 71]).buffer,
        mimeType: 'image/png',
      };
    },
    terminate() {},
  };
  const input = new CompressorHeicInput({
    createWorkerClient: () => worker,
    openFile: (file) => opened.push(file),
    setNotice: (notice) => notices.push(notice),
    FileClass: File,
  });
  await input.select(heic('family.photo.HEIF'));
  assert.deepEqual(calls, [
    ['inspect', 'family.photo.HEIF'],
    ['convert', 'family.photo.HEIF'],
  ]);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].name, 'family.photo.png');
  assert.equal(opened[0].type, 'image/png');
  assert.match(notices.at(-1).message, /HEIC.*PNG.*元数据|HEIC.*PNG.*EXIF/);
  assert.equal(notices.at(-1).kind, 'success');
});

test('failed HEIC conversion reports an actionable error and does not open editor', async () => {
  const notices = [];
  const opened = [];
  const worker = {
    inspect: async () => ({ isHeic: true, width: 20, height: 20 }),
    convert: async () => {
      throw new Error('decoder crashed');
    },
    terminate() {},
  };
  const input = new CompressorHeicInput({
    createWorkerClient: () => worker,
    openFile: (file) => opened.push(file),
    setNotice: (notice) => notices.push(notice),
  });
  await input.select(heic());
  assert.deepEqual(opened, []);
  assert.equal(notices.at(-1).kind, 'error');
  assert.match(notices.at(-1).message, /HEIC 解码失败.*文件|内存/);
});

test('a newer ordinary selection cancels ownership and stale HEIC never opens editor', async () => {
  const inspection = deferred();
  const opened = [];
  let terminated = 0;
  const worker = {
    inspect: () => inspection.promise,
    convert: async () => {
      throw new Error('stale conversion ran');
    },
    terminate: () => {
      terminated += 1;
    },
  };
  const input = new CompressorHeicInput({
    createWorkerClient: () => worker,
    openFile: (file) => opened.push(file),
  });
  const old = input.select(heic('old.heic'));
  await Promise.resolve();
  const jpg = ordinary('new.jpg');
  await input.select(jpg);
  inspection.resolve({ isHeic: true, width: 10, height: 10 });
  await old;
  assert.deepEqual(opened, [jpg]);
  assert.equal(terminated, 1);
});

test('a HEIC-named file without an ftyp signature is rejected before editor', async () => {
  const opened = [];
  const notices = [];
  const fake = { ...ordinary('fake.heic'), type: 'image/heic' };
  const input = new CompressorHeicInput({
    createWorkerClient: () => {
      throw new Error('worker must not load');
    },
    openFile: (file) => opened.push(file),
    setNotice: (notice) => notices.push(notice),
  });
  await input.select(fake);
  assert.deepEqual(opened, []);
  assert.match(notices.at(-1).message, /不是有效的 HEIC|签名/);
});

test('a renamed fake with HEIC ftyp candidate but failed worker confirmation is rejected', async () => {
  const opened = [];
  const notices = [];
  const worker = { inspect: async () => ({ isHeic: false }), terminate() {} };
  const input = new CompressorHeicInput({
    createWorkerClient: () => worker,
    openFile: (file) => opened.push(file),
    setNotice: (notice) => notices.push(notice),
  });
  await input.select(heic('fake.heic'));
  assert.deepEqual(opened, []);
  assert.match(notices.at(-1).message, /不是有效的 HEIC|签名无效/);
});
