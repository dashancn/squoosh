import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFile,
  hasWebpSignature,
  validateBatch,
  outputFilename,
  encoderOptions,
  VersionOwner,
  readinessMessage,
  CACHE_KEY,
} from '../src/core.mjs';

const MiB = 1024 * 1024;
const file = (name, size, type = '') => ({ name, size, type });

test('classifyFile requires real HEIC or WebP signature rather than MIME or extension', () => {
  assert.equal(classifyFile(file('photo.jpg', 1), true, false), 'heic');
  assert.equal(classifyFile(file('fake.heic', 1, 'image/jpeg'), false, false), 'unsupported');
  assert.equal(classifyFile(file('photo.bin', 1), false, true), 'webp');
  assert.equal(classifyFile(file('fake.webp', 1, 'image/webp'), false, false), 'unsupported');
});

test('hasWebpSignature recognizes RIFF....WEBP bytes only', () => {
  const valid = Uint8Array.from([0x52,0x49,0x46,0x46,1,2,3,4,0x57,0x45,0x42,0x50]);
  const fake = Uint8Array.from([0x52,0x49,0x46,0x46,1,2,3,4,0x4a,0x50,0x45,0x47]);
  assert.equal(hasWebpSignature(valid), true);
  assert.equal(hasWebpSignature(fake), false);
  assert.equal(hasWebpSignature(valid.subarray(0, 11)), false);
});

test('validateBatch accepts exact boundaries and rejects every exceeded limit', () => {
  assert.doesNotThrow(() => validateBatch(Array.from({ length: 4 }, (_, i) => file(`${i}.webp`, 20 * MiB, 'image/webp'))));
  assert.throws(() => validateBatch(Array.from({ length: 13 }, (_, i) => file(`${i}.webp`, 1, 'image/webp'))), /12/);
  assert.throws(() => validateBatch([file('large.webp', 20 * MiB + 1, 'image/webp')]), /20 MiB/);
  assert.throws(() => validateBatch(Array.from({ length: 5 }, (_, i) => file(`${i}.webp`, 16 * MiB + 1, 'image/webp'))), /80 MiB/);
});

test('outputFilename replaces the last extension and appends on extensionless names', () => {
  assert.equal(outputFilename('trip.photo.heic', 'jpeg'), 'trip.photo.jpg');
  assert.equal(outputFilename('透明图', 'png'), '透明图.png');
});

test('encoderOptions routes quality and JPG background only where applicable', () => {
  assert.deepEqual(encoderOptions('jpeg', 90, '#ffffff'), { type: 'image/jpeg', quality: 0.9, background: '#ffffff' });
  assert.deepEqual(encoderOptions('png', 12, '#000000'), { type: 'image/png' });
});

test('VersionOwner invalidates stale asynchronous work', () => {
  const owner = new VersionOwner();
  const first = owner.next();
  assert.equal(owner.isCurrent(first), true);
  owner.next();
  assert.equal(owner.isCurrent(first), false);
});

test('readiness cache advisory requires a successful HEIC conversion marker', () => {
  const empty = { getItem: () => null };
  const marked = { getItem: (key) => key === CACHE_KEY ? '1' : null };
  assert.match(readinessMessage(empty), /首次.*3\.0 MB.*0\.8 MB/);
  assert.match(readinessMessage(marked), /曾成功加载/);
});
