import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_ENCODED_BYTES,
  MAX_DECODED_PIXELS,
  MAX_DIMENSION,
  validateEncodedFile,
  validateDecodedDimensions,
  decodeValidatedRemovalInput,
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

test('解码图片采用经移动端峰值预算验证的 1600 万像素上限', () => {
  assert.equal(4000 * 4000, MAX_DECODED_PIXELS);
  assert.doesNotThrow(() => validateDecodedDimensions(4000, 4000));
});

test('解码图片超过 1600 万像素时显示明确中文错误', () => {
  assert.throws(
    () => validateDecodedDimensions(4001, 4000),
    /图片解码后不能超过 1600 万像素/,
  );
});

test('宽或高恰好 10000 像素时允许处理', () => {
  assert.equal(MAX_DIMENSION, 10000);
  assert.doesNotThrow(() => validateDecodedDimensions(10000, 1200));
  assert.doesNotThrow(() => validateDecodedDimensions(1200, 10000));
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
    width: 4000,
    height: 3000,
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

test('预览解码校验成功时把位图交给调用方管理', async () => {
  const bitmap = { width: 2, height: 3 };
  assert.equal(
    await decodeValidatedRemovalInput({ size: 1 }, async () => bitmap),
    bitmap,
  );
});

test('预览尺寸校验失败时仍释放已解码位图', async () => {
  let closed = false;
  await assert.rejects(
    decodeValidatedRemovalInput({ size: 1 }, async () => ({
      width: MAX_DIMENSION + 1,
      height: 1,
      close() {
        closed = true;
      },
    })),
    /不能超过 10000 像素/,
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
