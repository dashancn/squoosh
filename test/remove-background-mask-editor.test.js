import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBrushStamp,
  applyMaskToPixels,
  brushIndicatorDiameter,
  brushIndicatorVisible,
  clampPreviewPan,
  compositePreviewPixels,
  composeCroppedPixels,
  cropPixels,
  containedImageRect,
  normalizeCropRect,
  createMaskHistory,
  createRenderOwnership,
  interpolateStroke,
  isPrimaryPointerStart,
  toContainedSourcePoint,
} from '../remove-background/src/mask-editor.js';

test('landscape image is contained with vertical letterbox and maps all edges', () => {
  const rect = containedImageRect(
    { left: 10, top: 20, width: 300, height: 300 },
    400,
    200,
  );
  assert.deepEqual(rect, { left: 10, top: 95, width: 300, height: 150 });
  assert.deepEqual(toContainedSourcePoint(10, 95, rect, 400, 200), {
    x: 0,
    y: 0,
  });
  assert.deepEqual(toContainedSourcePoint(310, 245, rect, 400, 200), {
    x: 399,
    y: 199,
  });
  assert.equal(toContainedSourcePoint(160, 94.9, rect, 400, 200), null);
  assert.equal(toContainedSourcePoint(160, 245.1, rect, 400, 200), null);
});

test('portrait image is contained with horizontal letterbox and ignores bars', () => {
  const rect = containedImageRect(
    { left: 0, top: 0, width: 320, height: 180 },
    100,
    200,
  );
  assert.deepEqual(rect, { left: 115, top: 0, width: 90, height: 180 });
  assert.deepEqual(toContainedSourcePoint(160, 90, rect, 100, 200), {
    x: 50,
    y: 100,
  });
  assert.equal(toContainedSourcePoint(114, 90, rect, 100, 200), null);
  assert.equal(toContainedSourcePoint(206, 90, rect, 100, 200), null);
});

test('brush indicator diameter follows the displayed active crop scale', () => {
  assert.equal(
    brushIndicatorDiameter(36, { width: 640, height: 480 }, 320, 240),
    72,
  );
  assert.equal(
    brushIndicatorDiameter(36, { width: 640, height: 480 }, 160, 120),
    144,
  );
  assert.equal(brushIndicatorDiameter(36, null, 320, 240), 0);
});

test('brush indicator stays hidden while crop mode is active', () => {
  assert.equal(
    brushIndicatorVisible({
      point: { x: 1, y: 1 },
      hasMask: true,
      busy: false,
      cropMode: true,
    }),
    false,
  );
  assert.equal(
    brushIndicatorVisible({
      point: { x: 1, y: 1 },
      hasMask: true,
      busy: false,
      cropMode: false,
    }),
    true,
  );
});

test('preview pan is centered at fit and clamped in rendered CSS pixels', () => {
  assert.deepEqual(clampPreviewPan({ x: 100, y: -100 }, 1, 300, 200), {
    x: 0,
    y: 0,
  });
  assert.deepEqual(clampPreviewPan({ x: 100, y: -100 }, 2, 300, 200), {
    x: 75,
    y: -50,
  });
  assert.deepEqual(
    clampPreviewPan({ x: 1000, y: -1000 }, 2, 300, 150),
    { x: 75, y: -37.5 },
    'intrinsic canvas dimensions must not expand CSS translation limits',
  );
});

test('zoomed and panned image coordinates map through letterboxing', () => {
  const fit = containedImageRect(
    { left: 10, top: 20, width: 300, height: 300 },
    400,
    200,
  );
  const viewport = {
    left: fit.left - fit.width / 2 + 30,
    top: fit.top - fit.height / 2 - 15,
    width: fit.width * 2,
    height: fit.height * 2,
  };
  assert.deepEqual(
    toContainedSourcePoint(
      viewport.left + viewport.width / 2,
      viewport.top + viewport.height / 2,
      viewport,
      400,
      200,
    ),
    { x: 200, y: 100 },
  );
  assert.equal(toContainedSourcePoint(0, 0, viewport, 400, 200), null);
});

test('crop rectangles normalize, clamp, and keep at least one pixel', () => {
  assert.deepEqual(normalizeCropRect({ x: 8, y: 7 }, { x: 2, y: 1 }, 10, 8), {
    x: 2,
    y: 1,
    width: 6,
    height: 6,
  });
  assert.deepEqual(normalizeCropRect({ x: -4, y: 3 }, { x: 20, y: 3 }, 10, 8), {
    x: 0,
    y: 3,
    width: 10,
    height: 1,
  });
});

test('cropping returns exact dimensions without changing source pixels', () => {
  const source = Uint8ClampedArray.from([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
  ]);
  const cropped = cropPixels(
    source,
    3,
    2,
    { x: 1, y: 0, width: 2, height: 2 },
    2,
  );
  assert.deepEqual([...cropped], [3, 4, 5, 6, 9, 10, 11, 12]);
  assert.deepEqual([...source], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test('export composition allocates only the final crop-sized pixel buffer', () => {
  const source = Uint8ClampedArray.from([
    10, 20, 30, 255, 40, 50, 60, 200, 70, 80, 90, 100, 100, 110, 120, 255, 130,
    140, 150, 128, 160, 170, 180, 64,
  ]);
  const mask = Uint8ClampedArray.from([255, 255, 255, 255, 80, 255]);
  const output = composeCroppedPixels(
    source,
    mask,
    3,
    2,
    { x: 1, y: 0, width: 2, height: 2 },
    null,
  );
  assert.equal(output.length, 2 * 2 * 4);
  assert.deepEqual(
    [...output],
    [40, 50, 60, 200, 70, 80, 90, 100, 130, 140, 150, 80, 160, 170, 180, 64],
  );
});

test('fast strokes interpolate through the endpoint', () => {
  const points = interpolateStroke({ x: 2, y: 3 }, { x: 42, y: 3 }, 10);
  assert.deepEqual(points.at(-1), { x: 42, y: 3 });
  assert.ok(points.length >= 9, `insufficient samples: ${points.length}`);
});

test('brush stamp returns changed bounds and no-op information', () => {
  const width = 7;
  const height = 7;
  const originalAlpha = new Uint8ClampedArray(width * height).fill(210);
  const mask = new Uint8ClampedArray(originalAlpha);
  const erased = applyBrushStamp(
    mask,
    originalAlpha,
    width,
    height,
    3,
    3,
    1,
    'erase',
  );
  assert.deepEqual(erased, {
    changed: true,
    bounds: { left: 2, top: 2, right: 4, bottom: 4 },
  });
  assert.equal(mask[3 * width + 3], 0);
  const noop = applyBrushStamp(
    mask,
    originalAlpha,
    width,
    height,
    3,
    3,
    1,
    'erase',
  );
  assert.deepEqual(noop, { changed: false, bounds: null });
  const restored = applyBrushStamp(
    mask,
    originalAlpha,
    width,
    height,
    3,
    3,
    1,
    'restore',
  );
  assert.equal(restored.changed, true);
  assert.equal(mask[3 * width + 3], 210);
});

test('masking preserves original RGB and caps alpha by original alpha', () => {
  const source = new Uint8ClampedArray([10, 20, 30, 200, 40, 50, 60, 100]);
  const mask = new Uint8ClampedArray([80, 255]);
  assert.deepEqual(
    [...applyMaskToPixels(source, mask)],
    [10, 20, 30, 80, 40, 50, 60, 100],
  );
  assert.deepEqual([...source], [10, 20, 30, 200, 40, 50, 60, 100]);
});

test('transparent and solid backgrounds compose edited alpha correctly', () => {
  const foreground = new Uint8ClampedArray([100, 50, 0, 64]);
  assert.deepEqual(
    [...compositePreviewPixels(foreground, null)],
    [100, 50, 0, 64],
  );
  assert.deepEqual(
    [...compositePreviewPixels(foreground, [0, 0, 255])],
    [25, 13, 191, 255],
  );
});

test('history skips no-op commits and remains bounded', () => {
  const initial = new Uint8ClampedArray([255, 128, 0]);
  const history = createMaskHistory(initial, 3);
  assert.equal(history.commit(new Uint8ClampedArray(initial)), false);
  assert.equal(history.canUndo(), false);
  assert.equal(history.commit(new Uint8ClampedArray([200, 128, 0])), true);
  assert.equal(history.commit(new Uint8ClampedArray([100, 128, 0])), true);
  assert.equal(history.commit(new Uint8ClampedArray([50, 128, 0])), true);
  assert.deepEqual([...history.undo()], [100, 128, 0]);
  assert.deepEqual([...history.undo()], [200, 128, 0]);
  assert.equal(history.canUndo(), false, 'oldest retained snapshot is bounded');
  assert.deepEqual([...history.redo()], [100, 128, 0]);
  history.reset();
  assert.deepEqual([...history.current()], [...initial]);
  assert.equal(history.canRedo(), false);
  initial[0] = 1;
  assert.equal(history.current()[0], 255);
});

test('history accepts bounded dirty-region entries without rescanning the mask', () => {
  const initial = new Uint8ClampedArray([255, 255, 255, 255]);
  const history = createMaskHistory(initial, 3);
  assert.equal(
    history.commitEntry({
      indices: Uint32Array.from([1, 2]),
      before: Uint8ClampedArray.from([255, 255]),
      after: Uint8ClampedArray.from([0, 64]),
    }),
    true,
  );
  assert.deepEqual([...history.current()], [255, 0, 64, 255]);
  assert.deepEqual([...history.undo()], [...initial]);
  assert.deepEqual([...history.redo()], [255, 0, 64, 255]);
  assert.equal(
    history.commitEntry({
      indices: new Uint32Array(),
      before: new Uint8ClampedArray(),
      after: new Uint8ClampedArray(),
    }),
    false,
  );
});

test('render ownership serializes work and rejects stale revisions and files', async () => {
  const ownership = createRenderOwnership();
  ownership.select(1);
  ownership.reviseMask();
  ownership.reviseCrop();
  const firstToken = ownership.request('transparent');
  ownership.reviseMask();
  assert.equal(ownership.isCurrent(firstToken), false);
  assert.equal(ownership.pending, false);
  const secondToken = ownership.request('transparent');
  assert.equal(ownership.isCurrent(firstToken), false);
  assert.equal(ownership.isCurrent(secondToken), true);
  assert.equal(ownership.pending, true);
  assert.equal(ownership.publish(firstToken, new Blob(['old'])), false);
  assert.equal(ownership.publish(secondToken, new Blob(['new'])), true);
  assert.equal(ownership.pending, false);
  assert.equal(ownership.outputBlob.size, 3);

  const oldFileToken = ownership.request('white');
  ownership.select(2);
  assert.equal(ownership.publish(oldFileToken, new Blob(['stale'])), false);
  assert.equal(ownership.outputBlob, null);
  assert.equal(ownership.pending, false);
});

test('only an unclaimed primary pointer can start a stroke', () => {
  assert.equal(
    isPrimaryPointerStart({ isPrimary: true, button: 0 }, null),
    true,
  );
  assert.equal(isPrimaryPointerStart({ button: 0 }, null), true);
  assert.equal(
    isPrimaryPointerStart({ isPrimary: false, button: 0 }, null),
    false,
  );
  assert.equal(
    isPrimaryPointerStart({ isPrimary: true, button: 1 }, null),
    false,
  );
  assert.equal(isPrimaryPointerStart({ isPrimary: true, button: 0 }, 7), false);
});
