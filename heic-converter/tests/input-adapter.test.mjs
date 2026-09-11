import test from 'node:test';
import assert from 'node:assert/strict';
import {
  heicCandidateFromHeader,
  pngFilename,
  normalizeImageFile,
} from '../src/input-adapter.mjs';

const header = (brand) => {
  const bytes = new Uint8Array(12);
  bytes.set([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70]);
  bytes.set(new TextEncoder().encode(brand), 8);
  return bytes;
};
const MiB = 1024 * 1024;

test('HEIC adapter recognizes only supported real ftyp major brands', () => {
  for (const brand of [
    'mif1', 'msf1', 'heic', 'heix', 'hevc', 'hevx',
    'heim', 'heis', 'hevm', 'hevs',
  ]) {
    assert.equal(heicCandidateFromHeader(header(brand)), true, brand);
  }
  assert.equal(heicCandidateFromHeader(header('jpeg')), false);
  assert.equal(heicCandidateFromHeader(new Uint8Array(8)), false);
});

test('HEIC PNG output preserves the source basename', () => {
  assert.equal(pngFilename('trip.photo.heic'), 'trip.photo.png');
  assert.equal(pngFilename('portrait.HEIF'), 'portrait.png');
  assert.equal(pngFilename('portrait'), 'portrait.png');
});

test('ordinary images bypass the HEIC decoder entirely', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const ordinary = new File([bytes], 'ordinary.png', { type: 'image/png' });
  let created = 0;
  const result = await normalizeImageFile(ordinary, {
    createClient() { created += 1; throw new Error('decoder must stay lazy'); },
  });
  assert.equal(result, ordinary);
  assert.equal(created, 0);
});

test('HEIC candidate is inspected and converted to verified PNG', async () => {
  const input = new File([header('heic')], 'portrait.heic', { type: 'image/heic' });
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  let inspected = 0;
  let converted = 0;
  const result = await normalizeImageFile(input, {
    createClient() {
      return {
        async inspect(file) { inspected += 1; assert.equal(file, input); return { isHeic: true, width: 2, height: 3 }; },
        async convert(file) { converted += 1; assert.equal(file, input); return { buffer: png.buffer, mimeType: 'image/png' }; },
      };
    },
  });
  assert.equal(inspected, 1);
  assert.equal(converted, 1);
  assert.equal(result.name, 'portrait.png');
  assert.equal(result.type, 'image/png');
  assert.deepEqual([...new Uint8Array(await result.arrayBuffer()).slice(0, 8)], [...png.slice(0, 8)]);
});

test('adapter rejects oversized input and HEIC dimensions before conversion', async () => {
  const oversized = { size: 20 * 1024 * 1024 + 1, slice() { throw new Error('must reject before reading'); } };
  await assert.rejects(() => normalizeImageFile(oversized), /20 MiB/);
  const input = new File([header('heic')], 'huge.heic', { type: 'image/heic' });
  let converted = false;
  await assert.rejects(() => normalizeImageFile(input, { createClient: () => ({
    inspect: async () => ({ isHeic: true, width: 10001, height: 1 }),
    convert: async () => { converted = true; },
  }) }), /10000/);
  assert.equal(converted, false);
});

test('removal policy caps HEIC bytes, dimensions, and converted PNG before decode', async () => {
  let operations = [];
  const client = {
    inspect: async () => { operations.push('inspect'); return { isHeic: true, width: 4000, height: 2001 }; },
    convert: async () => { operations.push('convert'); return { buffer: new ArrayBuffer(8), mimeType: 'image/png' }; },
  };
  const limits = { maxFileBytes: 8 * MiB, maxPixels: 8_000_000, maxEdge: 10_000, maxOutputBytes: 8 * MiB };
  await assert.rejects(normalizeImageFile(new File([header('heic'), new Uint8Array(8 * MiB)], 'large.heic'), {
    createClient: () => client, limits,
  }), /HEIC 文件不能超过 8 MiB/);
  assert.deepEqual(operations, []);

  operations = [];
  await assert.rejects(normalizeImageFile(new File([header('heic')], 'pixels.heic'), {
    createClient: () => client, limits,
  }), /HEIC 图片不能超过 800 万像素/);
  assert.deepEqual(operations, ['inspect']);

  const png = new Uint8Array(8 * MiB + 1); png.set([137,80,78,71,13,10,26,10]);
  await assert.rejects(normalizeImageFile(new File([header('heic')], 'output.heic'), {
    createClient: () => ({ inspect: async () => ({ isHeic: true, width: 2000, height: 2000 }), convert: async () => ({ buffer: png.buffer, mimeType: 'image/png' }) }), limits,
  }), /转换后的 HEIC 图片不能超过 8 MiB/);

  const validPng = new Uint8Array([137,80,78,71,13,10,26,10,1]);
  let resourceArgs;
  await normalizeImageFile(new File([header('heic')], 'bounded.heic'), {
    createClient: () => ({ inspect: async () => ({ isHeic: true, width: 2000, height: 2000 }), convert: async () => ({ buffer: validPng.buffer, mimeType: 'image/png' }) }),
    limits: { ...limits, resourceInventory: (args) => { resourceArgs = args; } },
  });
  assert.deepEqual(resourceArgs, { width: 2000, height: 2000, originalEncodedBytes: 12, convertedEncodedBytes: 9 });
});
