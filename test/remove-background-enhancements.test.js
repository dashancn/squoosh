import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  applyBrushStamp,
  composeCroppedPixels,
  isAspectRatioSupported,
  normalizeAspectCropRect,
  normalizeAspectCropWithin,
  parseHexColor,
} from '../remove-background/src/mask-editor.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('comparison control exposes clear accessible hold and toggle state', async () => {
  const [html, source] = await Promise.all([
    read('remove-background/index.html'),
    read('remove-background/src/main.js'),
  ]);
  assert.match(html, /id="compare-button"[^>]*aria-pressed="false"/);
  assert.match(html, /id="compare-status"[^>]*aria-live="polite"/);
  assert.match(source, /setComparingOriginal/);
  assert.match(source, /pointerdown/);
  assert.match(source, /keydown/);
  assert.match(source, /original cropped image|原图/);
});

test('soft brush uses radial alpha and repeated erase/restore stamps converge', () => {
  const alpha = new Uint8ClampedArray(11 * 11).fill(255);
  const mask = new Uint8ClampedArray(alpha);
  applyBrushStamp(mask, alpha, 11, 11, 5, 5, 4, 'erase', undefined, 50);
  const edge = mask[5 * 11 + 8];
  assert.ok(edge > 0 && edge < 255, `expected feathered edge, got ${edge}`);
  const once = mask[5 * 11 + 5];
  applyBrushStamp(mask, alpha, 11, 11, 5, 5, 4, 'erase', undefined, 50);
  assert.ok(mask[5 * 11 + 5] <= once);
  applyBrushStamp(mask, alpha, 11, 11, 5, 5, 4, 'restore', undefined, 50);
  assert.ok(mask[5 * 11 + 5] > 0);
  const hard = new Uint8ClampedArray(alpha);
  applyBrushStamp(hard, alpha, 11, 11, 5, 5, 4, 'erase', undefined, 100);
  assert.equal(hard[5 * 11 + 8], 0);

  const quantized = new Uint8ClampedArray(alpha);
  for (let count = 0; count < 600; count += 1)
    applyBrushStamp(quantized, alpha, 11, 11, 5, 5, 4, 'erase', undefined, 1);
  assert.equal(
    quantized[5 * 11 + 8],
    0,
    'soft erase must not stall above zero',
  );
  for (let count = 0; count < 600; count += 1)
    applyBrushStamp(quantized, alpha, 11, 11, 5, 5, 4, 'restore', undefined, 1);
  assert.equal(
    quantized[5 * 11 + 8],
    alpha[5 * 11 + 8],
    'soft restore must reach original alpha despite Uint8 quantization',
  );
});

test('aspect crop follows drag direction, stays bounded, and yields exact ratios', () => {
  assert.deepEqual(
    normalizeAspectCropRect({ x: 90, y: 70 }, { x: 10, y: 10 }, 100, 80, 1),
    { x: 30, y: 10, width: 60, height: 60 },
  );
  assert.deepEqual(
    normalizeAspectCropRect(
      { x: 10, y: 10 },
      { x: 99, y: 79 },
      100,
      80,
      16 / 9,
    ),
    { x: 10, y: 10, width: 80, height: 45 },
  );
  for (const [start, end, expected] of [
    [
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 10, width: 16, height: 9 },
    ],
    [
      { x: 95, y: 75 },
      { x: -50, y: -50 },
      { x: 15, y: 30, width: 80, height: 45 },
    ],
    [
      { x: 5, y: 75 },
      { x: 500, y: -50 },
      { x: 5, y: 30, width: 80, height: 45 },
    ],
    [
      { x: 95, y: 5 },
      { x: -50, y: 500 },
      { x: 15, y: 5, width: 80, height: 45 },
    ],
  ]) {
    const crop = normalizeAspectCropRect(start, end, 100, 80, 16 / 9);
    assert.deepEqual(crop, expected);
    assert.equal(crop.width * 9, crop.height * 16);
    assert.ok(crop.x >= 0 && crop.y >= 0);
    assert.ok(crop.x + crop.width <= 100 && crop.y + crop.height <= 80);
  }
});

test('aspect presets reject images smaller than their minimum integer ratio unit', () => {
  assert.equal(isAspectRatioSupported(16, 9, 16 / 9), true);
  assert.equal(isAspectRatioSupported(15, 9, 16 / 9), false);
  assert.equal(isAspectRatioSupported(16, 8, 16 / 9), false);
  assert.equal(
    normalizeAspectCropRect({ x: 0, y: 0 }, { x: 14, y: 8 }, 15, 9, 16 / 9),
    null,
  );
  assert.equal(
    normalizeAspectCropRect({ x: 0, y: 0 }, { x: 15, y: 7 }, 16, 8, 16 / 9),
    null,
  );
});

test('aspect crop stays exact for every small supported size, zero drag, direction, and bound', () => {
  for (let width = 16; width <= 35; width += 1) {
    for (let height = 9; height <= 25; height += 1) {
      for (const start of [
        { x: 0, y: 0 },
        { x: width - 1, y: 0 },
        { x: 0, y: height - 1 },
        { x: width - 1, y: height - 1 },
        { x: Math.floor(width / 2), y: Math.floor(height / 2) },
      ]) {
        for (const end of [
          start,
          { x: -width, y: -height },
          { x: width * 2, y: -height },
          { x: -width, y: height * 2 },
          { x: width * 2, y: height * 2 },
        ]) {
          const crop = normalizeAspectCropRect(
            start,
            end,
            width,
            height,
            16 / 9,
          );
          assert.ok(crop);
          assert.equal(crop.width * 9, crop.height * 16);
          assert.ok(crop.x >= 0 && crop.y >= 0);
          assert.ok(crop.x + crop.width <= width);
          assert.ok(crop.y + crop.height <= height);
        }
      }
    }
  }
});

test('aspect recrop is normalized locally and never escapes the applied crop', () => {
  const applied = { x: 100, y: 50, width: 80, height: 45 };
  const cases = [
    [
      { x: 100, y: 50 },
      { x: 100, y: 50 },
    ],
    [
      { x: 179, y: 50 },
      { x: 0, y: 500 },
    ],
    [
      { x: 100, y: 94 },
      { x: 500, y: 0 },
    ],
    [
      { x: 179, y: 94 },
      { x: 0, y: 0 },
    ],
    [
      { x: 140, y: 72 },
      { x: 500, y: 500 },
    ],
  ];
  for (const [start, end] of cases) {
    const crop = normalizeAspectCropWithin(start, end, applied, 16 / 9);
    assert.ok(crop);
    assert.equal(crop.width * 9, crop.height * 16);
    assert.ok(crop.x >= applied.x);
    assert.ok(crop.y >= applied.y);
    assert.ok(crop.x + crop.width <= applied.x + applied.width);
    assert.ok(crop.y + crop.height <= applied.y + applied.height);
  }
});

test('hex colors sanitize and custom RGB composes exactly', () => {
  assert.deepEqual(parseHexColor('#1a2B3c'), [26, 43, 60]);
  assert.deepEqual(parseHexColor('abc'), [170, 187, 204]);
  assert.equal(parseHexColor('javascript:alert(1)'), null);
  const output = composeCroppedPixels(
    Uint8ClampedArray.from([100, 50, 0, 128]),
    Uint8ClampedArray.from([128]),
    1,
    1,
    { x: 0, y: 0, width: 1, height: 1 },
    [10, 20, 30],
  );
  assert.deepEqual([...output], [55, 35, 15, 255]);
});

test('cleanup and adjustments are deterministic, immutable, and ordered before composition', () => {
  const source = Uint8ClampedArray.from([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
  ]);
  const mask = Uint8ClampedArray.from([255, 128, 0]);
  const beforeSource = [...source];
  const beforeMask = [...mask];
  const options = {
    cleanup: 'medium',
    adjustments: { brightness: 10, contrast: 20, saturation: -30 },
  };
  const a = composeCroppedPixels(
    source,
    mask,
    3,
    1,
    { x: 0, y: 0, width: 3, height: 1 },
    null,
    options,
  );
  const b = composeCroppedPixels(
    source,
    mask,
    3,
    1,
    { x: 0, y: 0, width: 3, height: 1 },
    null,
    options,
  );
  assert.deepEqual([...a], [...b]);
  assert.deepEqual([...source], beforeSource);
  assert.deepEqual([...mask], beforeMask);
  assert.equal(a[3], 255);
  assert.equal(a[7], 128);
  assert.equal(a[11], 0);
});

test('all enhancement controls expose accessible defaults and reset hooks', async () => {
  const [html, source] = await Promise.all([
    read('remove-background/index.html'),
    read('remove-background/src/main.js'),
  ]);
  for (const value of ['free', 'original', '1:1', '3:4', '4:3', '16:9'])
    assert.match(html, new RegExp(`value="${value}"`));
  assert.match(html, /id="brush-hardness"[^>]*value="100"/);
  assert.match(html, /name="background" value="custom"/);
  assert.match(html, /id="custom-background-color"[^>]*type="color"/);
  assert.match(html, /id="cleanup-level"/);
  assert.match(html, /<details[^>]*id="adjustments-panel"/);
  for (const id of ['brightness', 'contrast', 'saturation'])
    assert.match(html, new RegExp(`id="${id}"[^>]*value="0"`));
  assert.match(html, /id="reset-adjustments"/);
  assert.match(source, /reviseEffects/);
  assert.match(source, /option\.disabled = !isAspectRatioSupported/);
  assert.match(source, /updateCropAspectAvailability\(\)/);
});
