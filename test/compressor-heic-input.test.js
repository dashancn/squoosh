import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_HEIC_FILE_BYTES,
  MAX_HEIC_PIXELS,
  MAX_HEIC_EDGE,
  hasHeicFtypSignature,
  pngFilenameFor,
  validateHeicFileSize,
  validateHeicDimensions,
} from '../src/client/initial-app/heic-input.mjs';

const bytes = (...values) => new Uint8Array(values);
const ftyp = (brand) =>
  bytes(
    0,
    0,
    0,
    24,
    0x66,
    0x74,
    0x79,
    0x70,
    ...new TextEncoder().encode(brand),
  );

test('HEIC candidates require a real supported ftyp major brand', () => {
  for (const brand of ['mif1', 'msf1', 'heic', 'heix', 'hevc', 'hevx']) {
    assert.equal(hasHeicFtypSignature(ftyp(brand)), true, brand);
  }
  assert.equal(hasHeicFtypSignature(ftyp('avif')), false);
  assert.equal(
    hasHeicFtypSignature(bytes(0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63)),
    false,
  );
  assert.equal(hasHeicFtypSignature(new Uint8Array(11)), false);
});

test('converted files preserve the base name and become PNG', () => {
  assert.equal(pngFilenameFor('portrait.heic'), 'portrait.png');
  assert.equal(pngFilenameFor('family.photo.HEIF'), 'family.photo.png');
  assert.equal(pngFilenameFor('.hidden'), '.hidden.png');
  assert.equal(pngFilenameFor('image'), 'image.png');
});

test('HEIC preflight enforces the exact 20 MiB file limit', () => {
  assert.equal(MAX_HEIC_FILE_BYTES, 20 * 1024 * 1024);
  assert.doesNotThrow(() => validateHeicFileSize(MAX_HEIC_FILE_BYTES));
  assert.throws(
    () => validateHeicFileSize(MAX_HEIC_FILE_BYTES + 1),
    /超过 20 MiB/,
  );
});

test('HEIC dimension preflight enforces exact 30 MP and 10000 edge limits', () => {
  assert.equal(MAX_HEIC_PIXELS, 30_000_000);
  assert.equal(MAX_HEIC_EDGE, 10_000);
  assert.doesNotThrow(() => validateHeicDimensions(10_000, 3_000));
  assert.doesNotThrow(() => validateHeicDimensions(6_000, 5_000));
  assert.throws(() => validateHeicDimensions(10_001, 1), /边长超过 10000/);
  assert.throws(() => validateHeicDimensions(6_001, 5_000), /超过 3000 万像素/);
});
