import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_ENCODED_BYTES,
  MAX_DECODED_PIXELS,
  MAX_DIMENSION,
  validateEncodedFile,
  validateDecodedDimensions,
  decodeAndValidateRemovalInput,
} from '../remove-background/src/input-limits.js';

test('编码文件恰好 20 MiB 时允许处理', () => {
  assert.doesNotThrow(() => validateEncodedFile({ size: MAX_ENCODED_BYTES }));
});

test('编码文件超过 20 MiB 一个字节时显示明确中文错误', () => {
  assert.throws(
    () => validateEncodedFile({ size: MAX_ENCODED_BYTES + 1 }),
    /图片文件不能超过 20 MiB/,
  );
});

test('解码图片恰好 3000 万像素且边长不超限时允许处理', () => {
  assert.equal(6000 * 5000, MAX_DECODED_PIXELS);
  assert.doesNotThrow(() => validateDecodedDimensions(6000, 5000));
});

test('解码图片超过 3000 万像素时显示明确中文错误', () => {
  assert.throws(
    () => validateDecodedDimensions(6001, 5000),
    /图片解码后不能超过 3000 万像素/,
  );
});

test('宽或高恰好 10000 像素时允许处理', () => {
  assert.equal(MAX_DIMENSION, 10000);
  assert.doesNotThrow(() => validateDecodedDimensions(10000, 3000));
  assert.doesNotThrow(() => validateDecodedDimensions(3000, 10000));
});

test('宽或高超过 10000 像素时显示明确中文错误', () => {
  assert.throws(
    () => validateDecodedDimensions(10001, 1),
    /图片宽度和高度均不能超过 10000 像素/,
  );
  assert.throws(
    () => validateDecodedDimensions(1, 10001),
    /图片宽度和高度均不能超过 10000 像素/,
  );
});

test('候选图片先安全解码校验并释放位图', async () => {
  let closed = false;
  const bitmap = {
    width: 6000,
    height: 5000,
    close() {
      closed = true;
    },
  };

  await decodeAndValidateRemovalInput(
    { size: MAX_ENCODED_BYTES },
    async () => bitmap,
  );
  assert.equal(closed, true);
});

test('无法解码的候选图片显示明确中文错误', async () => {
  await assert.rejects(
    decodeAndValidateRemovalInput({ size: 1 }, async () => {
      throw new Error('decoder detail');
    }),
    /无法解码图片，请选择有效的图片文件/,
  );
});
