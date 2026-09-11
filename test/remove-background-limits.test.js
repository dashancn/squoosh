import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_ENCODED_BYTES,
  MAX_DECODED_PIXELS,
  MAX_PRE_RESIZE_PIXELS,
  MAX_PROCESSED_ENCODED_BYTES,
  PREPROCESSING_MEMORY_BUDGET_BYTES,
  MAX_DIMENSION,
  MAX_HEIC_ENCODED_BYTES,
  heicPreprocessingInventory,
  preprocessingMemoryInventory,
  processedDimensions,
  validateEncodedFile,
  validateDecodedDimensions,
  validatePreResizeDimensions,
  decodeValidatedRemovalInput,
  decodeAndValidateRemovalInput,
} from '../remove-background/src/input-limits.js';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const pngFile = (width = 1, height = 1) => {
  const ihdr = [
    73,
    72,
    68,
    82,
    width >>> 24,
    (width >>> 16) & 255,
    (width >>> 8) & 255,
    width & 255,
    height >>> 24,
    (height >>> 16) & 255,
    (height >>> 8) & 255,
    height & 255,
    8,
    6,
    0,
    0,
    0,
  ];
  const crc = crc32(ihdr);
  return new File(
    [
      Uint8Array.from([
        137,
        80,
        78,
        71,
        13,
        10,
        26,
        10,
        0,
        0,
        0,
        13,
        ...ihdr,
        crc >>> 24,
        (crc >>> 16) & 255,
        (crc >>> 8) & 255,
        crc & 255,
      ]),
    ],
    'test.png',
    { type: 'image/png' },
  );
};

test('HEIC 预处理采用更严格边界并公开无法计量的 WASM 风险', () => {
  assert.equal(MAX_HEIC_ENCODED_BYTES, 8 * 1024 * 1024);
  const inventory = heicPreprocessingInventory({
    width: 4000,
    height: 2000,
    originalEncodedBytes: MAX_HEIC_ENCODED_BYTES,
    convertedEncodedBytes: MAX_PROCESSED_ENCODED_BYTES,
  });
  assert.deepEqual(Object.keys(inventory.allocations), [
    'originalHeicFile',
    'workerArrayBuffer',
    'decodedRgba',
    'conversionImageData',
    'conversionCanvasBacking',
    'convertedPng',
  ]);
  assert.equal(inventory.completeBudgetProof, false);
  assert.match(inventory.unbounded, /libheif.*libde265.*WASM/);
  assert.throws(
    () =>
      heicPreprocessingInventory({
        width: 4001,
        height: 2000,
        originalEncodedBytes: 1,
        convertedEncodedBytes: 1,
      }),
    /800 万像素/,
  );
});

test('编码文件恰好 20 MiB 时允许处理', () => {
  assert.doesNotThrow(() => validateEncodedFile({ size: MAX_ENCODED_BYTES }));
});

test('编码文件超过 20 MiB 一个字节时显示明确中文错误', () => {
  assert.throws(
    () => validateEncodedFile({ size: MAX_ENCODED_BYTES + 1 }),
    /图片文件不能超过 20 MiB/,
  );
});

test('解码图片采用经保守移动端峰值预算验证的 800 万像素上限', () => {
  assert.equal(4000 * 2000, MAX_DECODED_PIXELS);
  assert.doesNotThrow(() => validateDecodedDimensions(4000, 2000));
});

test('解码图片超过 800 万像素一个像素时显示精确中文错误', () => {
  assert.throws(() => validateDecodedDimensions(8000001, 1), {
    message: '图片解码后不能超过 800 万像素',
  });
});

test('4000x3000 相机图片精确缩放到不超过 800 万像素', () => {
  assert.deepEqual(processedDimensions(4000, 3000), {
    width: 3265,
    height: 2449,
  });
  assert.ok(3265 * 2449 <= MAX_DECODED_PIXELS);
  assert.deepEqual(processedDimensions(4000, 2000), {
    width: 4000,
    height: 2000,
  });
});

test('预缩放解码上限允许常见高像素相机图片且限制瞬时 RGBA 内存', () => {
  assert.equal(MAX_PRE_RESIZE_PIXELS, 30_000_000);
  assert.ok(
    MAX_PRE_RESIZE_PIXELS * 4 + MAX_DECODED_PIXELS * 8 + MAX_ENCODED_BYTES <
      256 * 1024 * 1024,
  );
  assert.doesNotThrow(() => validatePreResizeDimensions(7500, 4000));
});

test('预处理峰值清单包含所有同时存活分配并保守低于 256 MiB', () => {
  const processed = processedDimensions(7500, 4000);
  const inventory = preprocessingMemoryInventory({
    sourceWidth: 7500,
    sourceHeight: 4000,
    processedWidth: processed.width,
    processedHeight: processed.height,
    originalEncodedBytes: MAX_ENCODED_BYTES,
    processedEncodedBytes: MAX_PROCESSED_ENCODED_BYTES,
  });
  assert.deepEqual(Object.keys(inventory.allocations), [
    'sourceBitmap',
    'resizeCanvasBacking',
    'processedBitmap',
    'originalEncodedFile',
    'processedEncodedBlob',
    'runtimeHeadroom',
  ]);
  assert.equal(inventory.allocations.sourceBitmap, 30_000_000 * 4);
  assert.equal(
    inventory.allocations.resizeCanvasBacking,
    processed.width * processed.height * 4,
  );
  assert.equal(
    inventory.allocations.processedBitmap,
    processed.width * processed.height * 4,
  );
  assert.equal(inventory.allocations.originalEncodedFile, MAX_ENCODED_BYTES);
  assert.equal(inventory.allocations.processedEncodedBlob, 8 * 1024 * 1024);
  assert.equal(inventory.budgetBytes, PREPROCESSING_MEMORY_BUDGET_BYTES);
  assert.ok(inventory.totalBytes < 256 * 1024 * 1024);
});

test('预处理内存证明对越界输出和无法证明的数值 fail closed', () => {
  const processed = processedDimensions(7500, 4000);
  const base = {
    sourceWidth: 7500,
    sourceHeight: 4000,
    processedWidth: processed.width,
    processedHeight: processed.height,
    originalEncodedBytes: MAX_ENCODED_BYTES,
    processedEncodedBytes: MAX_PROCESSED_ENCODED_BYTES,
  };
  assert.throws(
    () =>
      preprocessingMemoryInventory({
        ...base,
        processedEncodedBytes: MAX_PROCESSED_ENCODED_BYTES + 1,
      }),
    /优化后的图片文件不能超过 8 MiB/,
  );
  assert.throws(
    () => preprocessingMemoryInventory({ ...base, sourceWidth: Number.NaN }),
    /无法证明图片预处理内存安全/,
  );
  assert.throws(
    () => preprocessingMemoryInventory({ ...base, sourceHeight: 4001 }),
    /无法证明图片预处理内存安全/,
  );
});

test('真正过大的图片在预缩放前显示明确中文错误', () => {
  assert.throws(() => validatePreResizeDimensions(7500, 4001), {
    message: '图片解码后超过预处理安全上限（3000 万像素）',
  });
});

test('宽或高恰好 10000 像素时允许处理', () => {
  assert.equal(MAX_DIMENSION, 10000);
  assert.doesNotThrow(() => validateDecodedDimensions(10000, 800));
  assert.doesNotThrow(() => validateDecodedDimensions(800, 10000));
});

test('宽或高超过 10000 像素时显示明确中文错误', () => {
  assert.throws(
    () => validateDecodedDimensions(10001, 799),
    /图片宽度和高度均不能超过 10000 像素/,
  );
  assert.throws(
    () => validateDecodedDimensions(799, 10001),
    /图片宽度和高度均不能超过 10000 像素/,
  );
});

test('候选图片先安全解码校验并释放位图', async () => {
  let closed = false;
  const bitmap = {
    width: 4000,
    height: 2000,
    close() {
      closed = true;
    },
  };

  await decodeAndValidateRemovalInput(pngFile(4000, 2000), async () => bitmap);
  assert.equal(closed, true);
});

test('预览解码校验成功时把位图交给调用方管理', async () => {
  const bitmap = { width: 2, height: 3 };
  assert.equal(
    await decodeValidatedRemovalInput(pngFile(2, 3), async () => bitmap),
    bitmap,
  );
});

test('预览尺寸校验失败时仍释放已解码位图', async () => {
  let closed = false;
  await assert.rejects(
    decodeValidatedRemovalInput(pngFile(), async () => ({
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
    decodeAndValidateRemovalInput(pngFile(), async () => {
      throw new Error('decoder detail');
    }),
    /无法解码图片，请选择有效的图片文件/,
  );
});
