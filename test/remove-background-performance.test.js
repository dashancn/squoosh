import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  composeCroppedPixels,
  composeCroppedPixelsAsync,
  createCoalescedScheduler,
  createMaskHistory,
  estimateEditorPeakBytes,
} from '../remove-background/src/mask-editor.js';

test('full-resolution composition yields cooperatively and matches synchronous pixels', async () => {
  const width = 64;
  const height = 8;
  const source = new Uint8ClampedArray(width * height * 4).fill(120);
  const mask = new Uint8ClampedArray(width * height).fill(200);
  const crop = { x: 0, y: 0, width, height };
  const options = {
    cleanup: 'medium',
    adjustments: { brightness: 10, contrast: 5, saturation: -5 },
  };
  let yields = 0;
  const output = await composeCroppedPixelsAsync(
    source,
    mask,
    width,
    height,
    crop,
    null,
    options,
    {
      rowsPerChunk: 2,
      yieldControl: async () => {
        yields += 1;
      },
    },
  );
  assert.ok(yields >= 3);
  assert.deepEqual(
    [...output],
    [...composeCroppedPixels(source, mask, width, height, crop, null, options)],
  );
});

test('stale cooperative composition interrupts and clears its output', async () => {
  const source = new Uint8ClampedArray(32 * 8 * 4).fill(120);
  const mask = new Uint8ClampedArray(32 * 8).fill(200);
  let cancelled = false;
  await assert.rejects(
    composeCroppedPixelsAsync(
      source,
      mask,
      32,
      8,
      { x: 0, y: 0, width: 32, height: 8 },
      null,
      {},
      {
        rowsPerChunk: 1,
        yieldControl: async () => {
          cancelled = true;
        },
        isCancelled: () => cancelled,
      },
    ),
    /cancel/i,
  );
});

test('slider scheduler debounces and coalesces stale requests', async () => {
  const values = [];
  const scheduler = createCoalescedScheduler(
    async (value) => values.push(value),
    5,
  );
  scheduler.schedule(1);
  scheduler.schedule(2);
  await scheduler.schedule(3);
  assert.deepEqual(values, [3]);
  scheduler.cancel();
});

test('12MP editor live-buffer contract stays within 256 MiB', () => {
  const estimate = estimateEditorPeakBytes(
    12_000_000,
    12_000_000,
    8 * 1024 * 1024,
  );
  assert.ok(estimate <= 256 * 1024 * 1024, `${estimate} exceeds mobile budget`);
});

test('history can adopt the editable mask and expose its live view without a full-size copy', () => {
  const mask = new Uint8ClampedArray([255, 128]);
  const history = createMaskHistory(mask, 20, 1024, { adoptCurrent: true });
  assert.equal(history.currentView(), mask);
  assert.notEqual(
    history.current(),
    mask,
    'public snapshot API remains defensive',
  );
});

test('stroke history obeys its explicit byte budget', () => {
  const history = createMaskHistory(new Uint8ClampedArray(8).fill(255), 20, 5);
  history.commitEntry({
    indices: Uint32Array.from([0]),
    before: Uint8ClampedArray.from([255]),
    after: Uint8ClampedArray.from([0]),
  });
  assert.equal(
    history.canUndo(),
    false,
    'a seven-byte entry must be evicted from a six-byte budget',
  );
  assert.equal(
    history.current()[0],
    0,
    'eviction must not revert the current mask',
  );
});

test('production path closes decoded bitmaps before first export and avoids sync full export', async () => {
  const source = await readFile(
    new URL('../remove-background/src/main.js', import.meta.url),
    'utf8',
  );
  const processingStart = source.indexOf(
    "startButton.addEventListener('click'",
  );
  const closeSource = source.indexOf('sourceBitmap.close?.()', processingStart);
  const firstExport = source.indexOf('await exportResult()', processingStart);
  assert.ok(closeSource >= processingStart && closeSource < firstExport);
  assert.doesNotMatch(source, /let output = composeCroppedPixels\(/);
  assert.match(source, /composeCroppedPixelsAsync/);
  assert.match(source, /createCoalescedScheduler/);
});
