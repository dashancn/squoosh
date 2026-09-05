import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLayout, MAX_EDGE, MAX_OUTPUT_PIXELS } from '../src/layout.mjs';

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

test('preset templates add common two, three and four image layouts', () => {
  const two = calculateLayout(images.slice(0, 2), { mode: 'two-columns', spacing: 10 });
  assert.equal(two.items.length, 2);
  assert.ok(two.items.every((item) => item.fit === 'cover'));
  const three = calculateLayout(images, { mode: 'three-feature', spacing: 10 });
  assert.equal(three.items[0].height, three.height);
  assert.equal(three.items[1].x, three.items[2].x);
  const four = calculateLayout([...images, images[0]], { mode: 'four-grid', spacing: 10 });
  assert.equal(four.items.length, 4);
});

test('three-feature divides an odd-spaced side column through the exact canvas bottom', () => {
  const layout = calculateLayout(images, {
    mode: 'three-feature', ratio: '1:1', cellWidth: 100, spacing: 17,
  });
  const upper = layout.items[1];
  const lower = layout.items[2];
  assert.equal(upper.y + upper.height + 17, lower.y);
  assert.equal(lower.y + lower.height, layout.height);
});

test('decorative templates cover their canvas and fall back without enough images', () => {
  const fourImages = [...images, images[0]];
  const expectations = {
    'left-stack-right-feature': [
      [0, 0, 400, 392], [0, 409, 400, 391], [417, 0, 400, 800],
    ],
    'top-feature-bottom-pair': [
      [0, 0, 817, 400], [0, 417, 400, 400], [417, 417, 400, 400],
    ],
    'bottom-feature-top-pair': [
      [0, 0, 400, 400], [417, 0, 400, 400], [0, 417, 817, 400],
    ],
    'asymmetric-mosaic': [
      [0, 0, 817, 400], [834, 0, 400, 817], [0, 417, 400, 400], [417, 417, 400, 400],
    ],
  };
  for (const [mode, rectangles] of Object.entries(expectations)) {
    const source = mode === 'asymmetric-mosaic' ? fourImages : images;
    const layout = calculateLayout(source, { mode, ratio: '1:1', cellWidth: 400, spacing: 17 });
    assert.deepEqual(layout.items.map(({ x, y, width, height }) => [x, y, width, height]), rectangles);
    assert.ok(layout.items.every((item) => item.x + item.width <= layout.width));
    assert.ok(layout.items.every((item) => item.y + item.height <= layout.height));
  }

  for (const mode of Object.keys(expectations)) {
    const layout = calculateLayout(images.slice(0, 2), { mode, cellWidth: 100, spacing: 17 });
    assert.equal(layout.items.length, 2);
    assert.equal(layout.items.at(-1).x + layout.items.at(-1).width, layout.width);
    assert.equal(layout.items.at(-1).y + layout.items.at(-1).height, layout.height);
  }
});

test('cover crop accepts per-image focal positions', () => {
  const layout = calculateLayout(images.slice(0, 1), {
    mode: 'grid', ratio: '16:9', focalPoints: [{ x: 0.25, y: 0.1 }],
  });
  assert.deepEqual(layout.items[0].focal, { x: 0.25, y: 0.1 });
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
  assert.ok(Math.max(layout.width, layout.height) <= MAX_EDGE);
  assert.ok(layout.width * layout.height <= MAX_OUTPUT_PIXELS);
  assert.ok(layout.scale < 1);
  assert.throws(() => calculateLayout([], {}), /At least one image/);
  assert.throws(() => calculateLayout(images, { mode: 'diagonal' }), /Unsupported collage mode/);
});

test('output permits exactly 36 MP and rejects neither pixel nor edge boundary', () => {
  const layout = calculateLayout([{ width: 6000, height: 6000 }], {
    mode: 'vertical',
    targetWidth: 6000,
  });
  assert.deepEqual({ width: layout.width, height: layout.height }, { width: 6000, height: 6000 });
  assert.equal(layout.width * layout.height, MAX_OUTPUT_PIXELS);
});

test('output above 36 MP is scaled to at most 36 MP', () => {
  const layout = calculateLayout([{ width: 6001, height: 6000 }], {
    mode: 'vertical',
    targetWidth: 6001,
  });
  assert.ok(layout.width * layout.height <= MAX_OUTPUT_PIXELS);
  assert.ok(layout.scale < 1);
});

test('output permits a 10000px edge and scales an edge above 10000px', () => {
  const boundary = calculateLayout([{ width: 10000, height: 1000 }], {
    mode: 'horizontal',
    targetHeight: 1000,
  });
  assert.equal(boundary.width, MAX_EDGE);
  const exceeded = calculateLayout([{ width: 10001, height: 1000 }], {
    mode: 'horizontal',
    targetHeight: 1000,
  });
  assert.ok(Math.max(exceeded.width, exceeded.height) <= MAX_EDGE);
  assert.ok(exceeded.scale < 1);
});
