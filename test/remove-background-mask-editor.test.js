import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBrushStamp,
  applyMaskToPixels,
  compositePreviewPixels,
  createMaskHistory,
  interpolateStroke,
  toSourcePoint,
} from '../remove-background/src/mask-editor.js';

test('显示坐标按画布实际比例转换并限制在源图范围内', () => {
  assert.deepEqual(
    toSourcePoint(
      260,
      170,
      { left: 100, top: 50, width: 320, height: 240 },
      640,
      480,
    ),
    { x: 320, y: 240 },
  );
  assert.deepEqual(
    toSourcePoint(
      20,
      900,
      { left: 100, top: 50, width: 320, height: 240 },
      640,
      480,
    ),
    { x: 0, y: 479 },
  );
});

test('快速笔划按笔刷半径插值且包含终点', () => {
  const points = interpolateStroke({ x: 2, y: 3 }, { x: 42, y: 3 }, 10);
  assert.deepEqual(points.at(-1), { x: 42, y: 3 });
  assert.ok(points.length >= 9, `插值点不足: ${points.length}`);
  for (let index = 1; index < points.length; index += 1) {
    assert.ok(points[index].x - points[index - 1].x <= 5.01);
  }
});

test('擦除只降低 alpha，恢复从原图 alpha 恢复且不越界', () => {
  const width = 5;
  const height = 5;
  const originalAlpha = new Uint8ClampedArray(width * height).fill(210);
  const mask = new Uint8ClampedArray(originalAlpha);
  applyBrushStamp(mask, originalAlpha, width, height, 2, 2, 1, 'erase');
  assert.equal(mask[2 * width + 2], 0);
  assert.equal(mask[0], 210);
  applyBrushStamp(mask, originalAlpha, width, height, 2, 2, 1, 'restore');
  assert.equal(mask[2 * width + 2], 210);
  assert.doesNotThrow(() =>
    applyBrushStamp(mask, originalAlpha, width, height, -10, 99, 20, 'erase'),
  );
});

test('编辑蒙版应用到原图像素并按原 alpha 上限合成', () => {
  const source = new Uint8ClampedArray([10, 20, 30, 200, 40, 50, 60, 100]);
  const mask = new Uint8ClampedArray([80, 255]);
  assert.deepEqual(
    [...applyMaskToPixels(source, mask)],
    [10, 20, 30, 80, 40, 50, 60, 100],
  );
  assert.deepEqual([...source], [10, 20, 30, 200, 40, 50, 60, 100]);
});

test('透明预览保留编辑 alpha，纯色背景按 alpha 正确合成', () => {
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

test('历史有界，撤销重做与重置恢复 AI 初始蒙版', () => {
  const initial = new Uint8ClampedArray([255, 128, 0]);
  const history = createMaskHistory(initial, 3);
  history.commit(new Uint8ClampedArray([200, 128, 0]));
  history.commit(new Uint8ClampedArray([100, 128, 0]));
  history.commit(new Uint8ClampedArray([50, 128, 0]));
  assert.deepEqual([...history.undo()], [100, 128, 0]);
  assert.deepEqual([...history.redo()], [50, 128, 0]);
  history.reset();
  assert.deepEqual([...history.current()], [...initial]);
  assert.equal(history.canRedo(), false);
  assert.equal(history.canUndo(), false);
  initial[0] = 1;
  assert.equal(history.current()[0], 255, '历史必须安全复制输入蒙版');
});
