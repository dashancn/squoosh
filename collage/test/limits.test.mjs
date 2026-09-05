import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_TOTAL_PIXELS,
  validateFiles,
  validateDecodedImage,
} from '../src/limits.mjs';

function sizedBlob(size) {
  const blob = new Blob(['x'], { type: 'image/png' });
  Object.defineProperty(blob, 'size', { value: size });
  return blob;
}

test('文件数量上限为 12：边界允许，超过 1 张拒绝', () => {
  assert.doesNotThrow(() => validateFiles(Array.from({ length: MAX_FILES }, () => sizedBlob(1))));
  assert.throws(
    () => validateFiles(Array.from({ length: MAX_FILES + 1 }, () => sizedBlob(1))),
    /最多选择 12 张图片/,
  );
});

test('单文件上限为 20 MiB：边界允许，超过 1 字节拒绝', () => {
  assert.doesNotThrow(() => validateFiles([sizedBlob(MAX_FILE_BYTES)]));
  assert.throws(() => validateFiles([sizedBlob(MAX_FILE_BYTES + 1)]), /每张图片不能超过 20 MiB/);
});

test('文件总大小上限为 80 MiB：边界允许，超过 1 字节拒绝', () => {
  assert.doesNotThrow(() =>
    validateFiles(Array.from({ length: 4 }, () => sizedBlob(MAX_TOTAL_BYTES / 4))),
  );
  assert.throws(
    () => validateFiles([sizedBlob(MAX_FILE_BYTES), sizedBlob(MAX_FILE_BYTES), sizedBlob(MAX_FILE_BYTES), sizedBlob(MAX_FILE_BYTES), sizedBlob(1)]),
    /所选图片总大小不能超过 80 MiB/,
  );
});

test('单图解码上限为 30 MP：边界允许，超过 1 像素拒绝', () => {
  assert.equal(validateDecodedImage({ width: 6000, height: 5000 }, 0), MAX_IMAGE_PIXELS);
  assert.throws(
    () => validateDecodedImage({ width: MAX_IMAGE_PIXELS + 1, height: 1 }, 0),
    /每张图片解码后不能超过 30 MP/,
  );
});

test('累计解码上限为 90 MP：边界允许，超过 1 像素拒绝', () => {
  assert.equal(validateDecodedImage({ width: 6000, height: 5000 }, 60_000_000), MAX_TOTAL_PIXELS);
  assert.throws(
    () => validateDecodedImage({ width: 6000, height: 5000 }, 60_000_001),
    /全部图片解码后总计不能超过 90 MP/,
  );
});
