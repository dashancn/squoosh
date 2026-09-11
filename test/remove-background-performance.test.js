import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  composeCroppedPixels,
  composeCroppedPixelsAsync,
  createCoalescedScheduler,
  createMaskHistory,
  createStrokeRecorder,
  editorMemoryInventory,
  estimateEditorPeakBytes,
} from '../remove-background/src/mask-editor.js';
import { MAX_DECODED_PIXELS } from '../remove-background/src/input-limits.js';

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

test('decoded-pixel limit has a conservative named allocation inventory below 256 MiB', () => {
  const inventory = editorMemoryInventory(MAX_DECODED_PIXELS);
  assert.deepEqual(Object.keys(inventory.allocations), [
    'sourceRgba',
    'editMaskCurrentLive',
    'originalAlpha',
    'maskHistoryInitial',
    'previewSourceCanvas',
    'previewImage',
    'fullOrCropOutput',
    'exportCanvasBacking',
    'encodedInputBlob',
    'foregroundBlob',
    'historyEntries',
    'liveStrokePhasePeak',
    'runtimeHeadroom',
  ]);
  assert.equal(inventory.allocations.sourceRgba, MAX_DECODED_PIXELS * 4);
  assert.equal(
    inventory.allocations.editMaskCurrentLive,
    MAX_DECODED_PIXELS,
    'editMask, history current, and currentView are one adopted live allocation',
  );
  assert.equal(inventory.allocations.originalAlpha, MAX_DECODED_PIXELS);
  assert.equal(inventory.allocations.maskHistoryInitial, MAX_DECODED_PIXELS);
  assert.equal(inventory.allocations.previewSourceCanvas, 1200 * 1200 * 4);
  assert.equal(inventory.allocations.previewImage, 1200 * 1200 * 4);
  assert.equal(inventory.allocations.fullOrCropOutput, MAX_DECODED_PIXELS * 4);
  assert.equal(
    inventory.allocations.exportCanvasBacking,
    MAX_DECODED_PIXELS * 4,
  );
  assert.equal(inventory.allocations.encodedInputBlob, 20 * 1024 * 1024);
  assert.equal(inventory.allocations.foregroundBlob, MAX_DECODED_PIXELS * 4);
  assert.equal(inventory.allocations.historyEntries, 24 * 1024 * 1024);
  assert.equal(inventory.allocations.liveStrokePhasePeak, 8 * 1024 * 1024);
  assert.equal(inventory.allocations.runtimeHeadroom, 32 * 1024 * 1024);
  assert.equal(inventory.totalBytes, 251_600_384);
  assert.ok(inventory.totalBytes < inventory.budgetBytes);
  assert.equal(
    estimateEditorPeakBytes(MAX_DECODED_PIXELS),
    inventory.totalBytes,
  );
  assert.deepEqual(inventory.strokePhases, {
    recording: {
      dedupeBits: 1_000_000,
      indicesCapacity: 4_925_736,
      beforeCapacity: 1_231_434,
      totalBytes: 7_157_170,
    },
    finalizing: {
      dedupeBits: 1_000_000,
      indicesCapacity: 4_925_736,
      beforeCapacity: 1_231_434,
      afterCapacity: 1_231_434,
      totalBytes: 8_388_604,
    },
    adoptedHistory: {
      indicesCapacity: 4_925_736,
      beforeCapacity: 1_231_434,
      afterCapacity: 1_231_434,
      totalBytes: 7_388_604,
    },
  });
  assert.deepEqual(inventory.historyNavigationPhase, {
    liveMaskBytes: MAX_DECODED_PIXELS,
    returnSnapshotBytes: 0,
    totalBytes: MAX_DECODED_PIXELS,
  });
  assert.ok(
    Math.max(
      ...Object.values(inventory.strokePhases).map((phase) => phase.totalBytes),
    ) <= inventory.allocations.liveStrokePhasePeak,
  );
});

test('next whole-megapixel limit is not conservatively safe', () => {
  const nextWholeMegapixel = MAX_DECODED_PIXELS + 1_000_000;
  const inventory = editorMemoryInventory(nextWholeMegapixel);
  assert.ok(
    inventory.totalBytes > inventory.budgetBytes,
    `${inventory.totalBytes} unexpectedly fits ${inventory.budgetBytes}`,
  );
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

test('history navigation mutates one adopted live mask without return snapshots', () => {
  const mask = new Uint8ClampedArray([255, 128, 0]);
  const history = createMaskHistory(mask, 20, 1024, { adoptCurrent: true });
  const live = history.currentView();
  assert.equal(history.commit(new Uint8ClampedArray([0, 128, 0])), true);

  assert.equal(history.undo(), live);
  assert.equal(history.currentView(), live);
  assert.deepEqual([...live], [255, 128, 0]);

  assert.equal(history.redo(), live);
  assert.equal(history.currentView(), live);
  assert.deepEqual([...live], [0, 128, 0]);

  assert.equal(history.reset(), live);
  assert.equal(history.currentView(), live);
  assert.equal(history.currentView(), mask);
  assert.deepEqual([...live], [255, 128, 0]);

  const snapshot = history.current();
  assert.notEqual(snapshot, live);
  snapshot[0] = 7;
  assert.equal(live[0], 255, 'explicit current() snapshots remain defensive');
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

test('broad 8 MP stroke recording stays within its explicit live byte budget', () => {
  const pixelCount = 8_000_000;
  const byteBudget = 8 * 1024 * 1024;
  const mask = new Uint8ClampedArray(pixelCount).fill(255);
  const recorder = createStrokeRecorder(pixelCount, byteBudget);
  let accepted = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    if (!recorder.record(index, mask[index])) break;
    mask[index] = 0;
    accepted += 1;
  }
  assert.ok(accepted > 1_000_000, 'budget should allow a useful broad stroke');
  assert.ok(accepted < pixelCount, '8 MiB must not pretend to record all 8 MP');
  assert.equal(recorder.record(accepted, 255), false);
  const entry = recorder.finish(mask);
  assert.equal(entry.indices.length, accepted);
  assert.equal(entry.before.length, accepted);
  assert.equal(entry.after.length, accepted);
  assert.ok(entry.ownedByteLength <= byteBudget);
  assert.ok(recorder.peakBytes() <= byteBudget);
});

test('stroke recorder deduplicates and history adopts finalized storage', () => {
  const mask = new Uint8ClampedArray([255, 255, 255]);
  const recorder = createStrokeRecorder(mask.length, 64);
  assert.equal(recorder.record(1, 255), true);
  mask[1] = 128;
  assert.equal(recorder.record(1, 128), true);
  mask[1] = 0;
  const entry = recorder.finish(mask);
  assert.deepEqual([...entry.indices], [1]);
  assert.deepEqual([...entry.before], [255]);
  assert.deepEqual([...entry.after], [0]);
  const history = createMaskHistory(mask, 20, 64, { adoptCurrent: true });
  assert.equal(history.commitEntry(entry, { adopt: true }), true);
  assert.equal(history.entryStorageBytes(), entry.ownedByteLength);
  assert.deepEqual([...history.undo()], [255, 255, 255]);
});

for (const operation of ['reset', 'clear']) {
  test(`history ${operation} releases its byte budget before commit and undo`, () => {
    const history = createMaskHistory(new Uint8ClampedArray([255, 255]), 20, 7);
    assert.equal(history.commit(new Uint8ClampedArray([0, 255])), true);
    history[operation]();
    const baseline = history.current();
    const changed = new Uint8ClampedArray(baseline);
    changed[1] = baseline[1] === 0 ? 255 : 0;
    assert.equal(history.commit(changed), true);
    assert.equal(
      history.canUndo(),
      true,
      'new entry must fit the released budget',
    );
    assert.deepEqual(history.undo(), baseline);
  });
}

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
  assert.doesNotMatch(
    source,
    /editMask\s*=\s*maskHistory\.(?:undo|redo|reset)\s*\(/,
  );
  assert.doesNotMatch(
    source,
    /maskHistory\.(?:undo|redo|reset)\s*\(\);\s*editMask\s*=\s*maskHistory\.currentView\s*\(\)/s,
  );
});
