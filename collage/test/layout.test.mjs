import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLayout, MAX_EDGE } from '../src/layout.mjs';

const images = [
  { width: 400, height: 300 },
  { width: 300, height: 500 },
  { width: 640, height: 360 },
];

test('grid creates requested aspect-ratio cells with spacing', () => {
  const layout = calculateLayout(images, {
    mode: 'grid',
    ratio: '4:3',
    spacing: 20,
    columns: 2,
  });
  assert.deepEqual({ width: layout.width, height: layout.height }, { width: 820, height: 620 });
  assert.deepEqual(layout.items[2], {
    x: 0,
    y: 320,
    width: 400,
    height: 300,
    fit: 'cover',
  });
});

test('vertical strip preserves image ratios', () => {
  const layout = calculateLayout(images, {
    mode: 'vertical',
    spacing: 12,
    targetWidth: 640,
  });
  assert.deepEqual({ width: layout.width, height: layout.height }, { width: 640, height: 1931 });
  assert.ok(layout.items.every((item) => item.fit === 'contain'));
  assert.deepEqual(layout.items.map(({ y, width, height }) => ({ y, width, height })), [
    { y: 0, width: 640, height: 480 },
    { y: 492, width: 640, height: 1067 },
    { y: 1571, width: 640, height: 360 },
  ]);
});

test('horizontal strip preserves image ratios', () => {
  const layout = calculateLayout(images, {
    mode: 'horizontal',
    spacing: 12,
    targetHeight: 300,
  });
  assert.deepEqual({ width: layout.width, height: layout.height }, { width: 1137, height: 300 });
  assert.deepEqual(layout.items.map(({ x, width, height }) => ({ x, width, height })), [
    { x: 0, width: 400, height: 300 },
    { x: 412, width: 180, height: 300 },
    { x: 604, width: 533, height: 300 },
  ]);
});

test('invalid values are normalized and output is clamped to safe canvas limits', () => {
  const layout = calculateLayout(
    [
      { width: 8000, height: 4000 },
      { width: 4000, height: 8000 },
      { width: 6000, height: 6000 },
    ],
    { mode: 'vertical', spacing: -100 },
  );
  assert.equal(Math.max(layout.width, layout.height), MAX_EDGE);
  assert.ok(layout.scale < 1);
  assert.throws(() => calculateLayout([], {}), /At least one image/);
  assert.throws(() => calculateLayout(images, { mode: 'diagonal' }), /Unsupported collage mode/);
});
