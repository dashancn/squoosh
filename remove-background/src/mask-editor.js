const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

export function containedImageRect(box, sourceWidth, sourceHeight) {
  if (
    box.width <= 0 ||
    box.height <= 0 ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  )
    return null;
  const scale = Math.min(box.width / sourceWidth, box.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    left: box.left + (box.width - width) / 2,
    top: box.top + (box.height - height) / 2,
    width,
    height,
  };
}

export function toContainedSourcePoint(
  clientX,
  clientY,
  imageRect,
  width,
  height,
) {
  if (
    !imageRect ||
    clientX < imageRect.left ||
    clientY < imageRect.top ||
    clientX > imageRect.left + imageRect.width ||
    clientY > imageRect.top + imageRect.height
  )
    return null;
  return {
    x: clamp(
      ((clientX - imageRect.left) / imageRect.width) * width,
      0,
      width - 1,
    ),
    y: clamp(
      ((clientY - imageRect.top) / imageRect.height) * height,
      0,
      height - 1,
    ),
  };
}

export function brushIndicatorDiameter(
  brushSize,
  imageRect,
  sourceWidth,
  sourceHeight,
) {
  if (!imageRect || sourceWidth <= 0 || sourceHeight <= 0) return 0;
  const scale = Math.min(
    imageRect.width / sourceWidth,
    imageRect.height / sourceHeight,
  );
  return Math.max(1, Number(brushSize) * scale);
}

export function brushIndicatorVisible({ point, hasMask, busy, cropMode }) {
  return Boolean(point && hasMask && !busy && !cropMode);
}

export function clampPreviewPan(pan, zoom, width, height) {
  if (zoom <= 1) return { x: 0, y: 0 };
  const maximumX = (width * (zoom - 1)) / (2 * zoom);
  const maximumY = (height * (zoom - 1)) / (2 * zoom);
  return {
    x: clamp(pan.x, -maximumX, maximumX),
    y: clamp(pan.y, -maximumY, maximumY),
  };
}

export function normalizeCropRect(start, end, width, height) {
  const startX = clamp(Math.floor(Math.min(start.x, end.x)), 0, width - 1);
  const startY = clamp(Math.floor(Math.min(start.y, end.y)), 0, height - 1);
  const endX = clamp(Math.ceil(Math.max(start.x, end.x)), startX + 1, width);
  const endY = clamp(Math.ceil(Math.max(start.y, end.y)), startY + 1, height);
  return {
    x: startX,
    y: startY,
    width: endX - startX,
    height: endY - startY,
  };
}

function integerRatio(value, maximumDenominator = 10_000) {
  let bestNumerator = 1;
  let bestDenominator = 1;
  let bestError = Math.abs(value - 1);
  for (
    let denominator = 1;
    denominator <= maximumDenominator;
    denominator += 1
  ) {
    const numerator = Math.max(1, Math.round(value * denominator));
    const error = Math.abs(value - numerator / denominator);
    if (error < bestError) {
      bestNumerator = numerator;
      bestDenominator = denominator;
      bestError = error;
      if (error <= Number.EPSILON * Math.max(1, value)) break;
    }
  }
  return [bestNumerator, bestDenominator];
}

export function isAspectRatioSupported(width, height, ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return true;
  const [unitWidth, unitHeight] = integerRatio(ratio);
  return width >= unitWidth && height >= unitHeight;
}

export function normalizeAspectCropRect(start, end, width, height, ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0)
    return normalizeCropRect(start, end, width, height);
  const [unitWidth, unitHeight] = integerRatio(ratio);
  const availableUnits = Math.floor(
    Math.min(width / unitWidth, height / unitHeight),
  );
  if (availableUnits < 1) return null;
  const sx = clamp(Math.round(start.x), 0, width - 1);
  const sy = clamp(Math.round(start.y), 0, height - 1);
  const signX = end.x < sx ? -1 : 1;
  const signY = end.y < sy ? -1 : 1;
  const availableWidth = Math.max(0, signX > 0 ? width - sx : sx);
  const availableHeight = Math.max(0, signY > 0 ? height - sy : sy);
  const directionalUnits = Math.floor(
    Math.min(availableWidth / unitWidth, availableHeight / unitHeight),
  );
  const requestedUnits = Math.floor(
    Math.min(
      Math.abs(end.x - sx) / unitWidth,
      Math.abs(end.y - sy) / unitHeight,
    ),
  );
  const units = Math.max(
    1,
    Math.min(requestedUnits || 1, directionalUnits || 1, availableUnits),
  );
  const cropWidth = unitWidth * units;
  const cropHeight = unitHeight * units;
  return {
    x: clamp(signX > 0 ? sx : sx - cropWidth, 0, width - cropWidth),
    y: clamp(signY > 0 ? sy : sy - cropHeight, 0, height - cropHeight),
    width: cropWidth,
    height: cropHeight,
  };
}

export function parseHexColor(value) {
  const match = String(value ?? '')
    .trim()
    .match(/^#?([\da-f]{3}|[\da-f]{6})$/i);
  if (!match) return null;
  const hex =
    match[1].length === 3
      ? [...match[1]].map((part) => part + part).join('')
      : match[1];
  return [0, 2, 4].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16),
  );
}

export function cropPixels(pixels, width, height, crop, channels = 4) {
  const safeCrop = normalizeCropRect(
    { x: crop.x, y: crop.y },
    { x: crop.x + crop.width, y: crop.y + crop.height },
    width,
    height,
  );
  const output = new pixels.constructor(
    safeCrop.width * safeCrop.height * channels,
  );
  for (let y = 0; y < safeCrop.height; y += 1) {
    const sourceStart = ((safeCrop.y + y) * width + safeCrop.x) * channels;
    const sourceEnd = sourceStart + safeCrop.width * channels;
    output.set(
      pixels.subarray(sourceStart, sourceEnd),
      y * safeCrop.width * channels,
    );
  }
  return output;
}

function adjustRgb(red, green, blue, values, precomputed = false) {
  const brightness = precomputed
    ? values.brightness
    : clamp(Number(values.brightness) || 0, -100, 100) * 2.55;
  const contrast = precomputed
    ? values.contrast
    : (() => {
        const value = clamp(Number(values.contrast) || 0, -100, 100);
        return (259 * (value + 255)) / (255 * (259 - value));
      })();
  const saturation = precomputed
    ? values.saturation
    : 1 + clamp(Number(values.saturation) || 0, -100, 100) / 100;
  red = contrast * (red - 128) + 128 + brightness;
  green = contrast * (green - 128) + 128 + brightness;
  blue = contrast * (blue - 128) + 128 + brightness;
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  return [
    clamp(luminance + (red - luminance) * saturation, 0, 255),
    clamp(luminance + (green - luminance) * saturation, 0, 255),
    clamp(luminance + (blue - luminance) * saturation, 0, 255),
  ];
}

export function adjustForegroundRgb(red, green, blue, adjustments = {}) {
  return adjustRgb(red, green, blue, adjustments);
}

export function composePixelAt(
  sourcePixels,
  mask,
  width,
  height,
  sourceX,
  sourceY,
  background,
  options = {},
  target = new Uint8ClampedArray(4),
  offset = 0,
) {
  const x = clamp(Math.floor(sourceX), 0, width - 1);
  const y = clamp(Math.floor(sourceY), 0, height - 1);
  const sourceIndex = y * width + x;
  const sourceOffset = sourceIndex * 4;
  const alpha = Math.min(sourcePixels[sourceOffset + 3], mask[sourceIndex]);
  let red = sourcePixels[sourceOffset];
  let green = sourcePixels[sourceOffset + 1];
  let blue = sourcePixels[sourceOffset + 2];
  const computed = options._computed;
  const cleanupStrength = computed
    ? computed.cleanupStrength
    : options.cleanup === 'medium'
    ? 0.45
    : options.cleanup === 'light'
    ? 0.22
    : 0;
  if (cleanupStrength && alpha > 0 && alpha < 255) {
    let totalRed = 0;
    let totalGreen = 0;
    let totalBlue = 0;
    let totalWeight = 0;
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        if (!ox && !oy) continue;
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        const neighborAlpha = Math.min(
          sourcePixels[neighbor * 4 + 3],
          mask[neighbor],
        );
        if (neighborAlpha <= alpha) continue;
        totalRed += sourcePixels[neighbor * 4] * neighborAlpha;
        totalGreen += sourcePixels[neighbor * 4 + 1] * neighborAlpha;
        totalBlue += sourcePixels[neighbor * 4 + 2] * neighborAlpha;
        totalWeight += neighborAlpha;
      }
    }
    if (totalWeight) {
      const amount = cleanupStrength * (1 - alpha / 255);
      red += (totalRed / totalWeight - red) * amount;
      green += (totalGreen / totalWeight - green) * amount;
      blue += (totalBlue / totalWeight - blue) * amount;
    }
  }
  const adjustments = options.adjustments || {};
  const brightness = computed
    ? computed.brightness
    : clamp(Number(adjustments.brightness) || 0, -100, 100) * 2.55;
  const contrastValue = clamp(Number(adjustments.contrast) || 0, -100, 100);
  const contrast = computed
    ? computed.contrast
    : (259 * (contrastValue + 255)) / (255 * (259 - contrastValue));
  const saturation = computed
    ? computed.saturation
    : 1 + clamp(Number(adjustments.saturation) || 0, -100, 100) / 100;
  red = contrast * (red - 128) + 128 + brightness;
  green = contrast * (green - 128) + 128 + brightness;
  blue = contrast * (blue - 128) + 128 + brightness;
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  red = clamp(luminance + (red - luminance) * saturation, 0, 255);
  green = clamp(luminance + (green - luminance) * saturation, 0, 255);
  blue = clamp(luminance + (blue - luminance) * saturation, 0, 255);
  if (!background) {
    target[offset] = red;
    target[offset + 1] = green;
    target[offset + 2] = blue;
    target[offset + 3] = alpha;
    return target;
  }
  const amount = alpha / 255;
  target[offset] = Math.round(red * amount + background[0] * (1 - amount));
  target[offset + 1] = Math.round(
    green * amount + background[1] * (1 - amount),
  );
  target[offset + 2] = Math.round(blue * amount + background[2] * (1 - amount));
  target[offset + 3] = 255;
  return target;
}

export function composeCroppedPixels(
  sourcePixels,
  mask,
  width,
  height,
  crop,
  background,
  options = {},
) {
  const safeCrop = normalizeCropRect(
    { x: crop.x, y: crop.y },
    { x: crop.x + crop.width, y: crop.y + crop.height },
    width,
    height,
  );
  const output = new Uint8ClampedArray(safeCrop.width * safeCrop.height * 4);
  for (let y = 0; y < safeCrop.height; y += 1) {
    for (let x = 0; x < safeCrop.width; x += 1) {
      const outputOffset = (y * safeCrop.width + x) * 4;
      composePixelAt(
        sourcePixels,
        mask,
        width,
        height,
        safeCrop.x + x,
        safeCrop.y + y,
        background,
        options,
        output,
        outputOffset,
      );
    }
  }
  return output;
}

export async function composeCroppedPixelsAsync(
  sourcePixels,
  mask,
  width,
  height,
  crop,
  background,
  options = {},
  control = {},
) {
  const safeCrop = normalizeCropRect(
    { x: crop.x, y: crop.y },
    { x: crop.x + crop.width, y: crop.y + crop.height },
    width,
    height,
  );
  const adjustments = options.adjustments || {};
  const contrastValue = clamp(Number(adjustments.contrast) || 0, -100, 100);
  const computedOptions = {
    ...options,
    _computed: {
      cleanupStrength:
        options.cleanup === 'medium'
          ? 0.45
          : options.cleanup === 'light'
          ? 0.22
          : 0,
      brightness: clamp(Number(adjustments.brightness) || 0, -100, 100) * 2.55,
      contrast: (259 * (contrastValue + 255)) / (255 * (259 - contrastValue)),
      saturation:
        1 + clamp(Number(adjustments.saturation) || 0, -100, 100) / 100,
    },
  };
  const output = new Uint8ClampedArray(safeCrop.width * safeCrop.height * 4);
  const rowsPerChunk = Math.max(1, control.rowsPerChunk || 16);
  const yieldControl =
    control.yieldControl || (() => new Promise(requestAnimationFrame));
  try {
    for (let y = 0; y < safeCrop.height; y += 1) {
      if (control.isCancelled?.()) throw new Error('Composition cancelled');
      for (let x = 0; x < safeCrop.width; x += 1) {
        composePixelAt(
          sourcePixels,
          mask,
          width,
          height,
          safeCrop.x + x,
          safeCrop.y + y,
          background,
          computedOptions,
          output,
          (y * safeCrop.width + x) * 4,
        );
      }
      if ((y + 1) % rowsPerChunk === 0 && y + 1 < safeCrop.height)
        await yieldControl();
    }
    if (control.isCancelled?.()) throw new Error('Composition cancelled');
    return output;
  } catch (error) {
    output.fill(0);
    throw error;
  }
}

export function createCoalescedScheduler(run, delay = 80) {
  let timer = null;
  let generation = 0;
  let pendingResolve = null;
  return {
    schedule(value) {
      generation += 1;
      const scheduledGeneration = generation;
      clearTimeout(timer);
      pendingResolve?.();
      return new Promise((resolve) => {
        pendingResolve = resolve;
        timer = setTimeout(async () => {
          if (scheduledGeneration === generation) await run(value);
          pendingResolve = null;
          resolve();
        }, delay);
      });
    },
    cancel() {
      generation += 1;
      clearTimeout(timer);
      pendingResolve?.();
      pendingResolve = null;
    },
  };
}

export function editorMemoryInventory(
  sourcePixels,
  outputPixels = sourcePixels,
) {
  const previewPixels = 1200 * 1200;
  const allocations = {
    sourceRgba: sourcePixels * 4,
    // createMaskHistory(..., { adoptCurrent: true }) keeps these three names
    // on one Uint8ClampedArray rather than three full-size mask allocations.
    editMaskCurrentLive: sourcePixels,
    originalAlpha: sourcePixels,
    maskHistoryInitial: sourcePixels,
    // Selection preview may still own the preview canvas backing when the
    // editable ImageData allocation is created for immediate result preview.
    previewSourceCanvas: previewPixels * 4,
    previewImage: previewPixels * 4,
    fullOrCropOutput: outputPixels * 4,
    exportCanvasBacking: outputPixels * 4,
    encodedInputBlob: 20 * 1024 * 1024,
    // PNG foreground is conservatively bounded by decoded RGBA size.
    foregroundBlob: sourcePixels * 4,
    historyEntries: 24 * 1024 * 1024,
    liveStroke: 8 * 1024 * 1024,
    // Browser canvas/ImageBitmap bookkeeping, JS objects, and model-runtime
    // allocations that overlap the editor's foreground phase.
    runtimeHeadroom: 32 * 1024 * 1024,
  };
  return {
    allocations,
    totalBytes: Object.values(allocations).reduce(
      (total, bytes) => total + bytes,
      0,
    ),
    budgetBytes: 256 * 1024 * 1024,
  };
}

export function estimateEditorPeakBytes(
  sourcePixels,
  outputPixels = sourcePixels,
) {
  return editorMemoryInventory(sourcePixels, outputPixels).totalBytes;
}

export function interpolateStroke(from, to, radius) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const spacing = Math.max(1, radius * 0.4);
  const steps = Math.max(1, Math.ceil(distance / spacing));
  return Array.from({ length: steps }, (_, index) => {
    const amount = (index + 1) / steps;
    return {
      x: from.x + (to.x - from.x) * amount,
      y: from.y + (to.y - from.y) * amount,
    };
  });
}

export function applyBrushStamp(
  mask,
  originalAlpha,
  width,
  height,
  centerX,
  centerY,
  radius,
  mode,
  onChange,
  hardness = 100,
) {
  const safeRadius = Math.max(0.5, radius);
  const startX = clamp(Math.floor(centerX - safeRadius), 0, width - 1);
  const endX = clamp(Math.ceil(centerX + safeRadius), 0, width - 1);
  const startY = clamp(Math.floor(centerY - safeRadius), 0, height - 1);
  const endY = clamp(Math.ceil(centerY + safeRadius), 0, height - 1);
  const radiusSquared = safeRadius * safeRadius;
  const hardRadius = safeRadius * clamp(Number(hardness) / 100, 0, 1);
  let changed = false;

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const distanceSquared = (x - centerX) ** 2 + (y - centerY) ** 2;
      if (distanceSquared > radiusSquared) continue;
      const distance = Math.sqrt(distanceSquared);
      const strength =
        hardRadius >= safeRadius || distance <= hardRadius
          ? 1
          : clamp(
              1 - (distance - hardRadius) / (safeRadius - hardRadius),
              0,
              1,
            );
      const index = y * width + x;
      const current = mask[index];
      const target = mode === 'restore' ? originalAlpha[index] : 0;
      const distanceToTarget = target - current;
      let next = Math.round(current + distanceToTarget * strength);
      if (strength > 0 && next === current && distanceToTarget !== 0)
        next = current + Math.sign(distanceToTarget);
      next = clamp(next, Math.min(current, target), Math.max(current, target));
      if (current === next) continue;
      onChange?.(index, mask[index], next);
      mask[index] = next;
      changed = true;
    }
  }
  return {
    changed,
    bounds: changed
      ? { left: startX, top: startY, right: endX, bottom: endY }
      : null,
  };
}

export function mergeBounds(first, second) {
  if (!first) return second;
  if (!second) return first;
  return {
    left: Math.min(first.left, second.left),
    top: Math.min(first.top, second.top),
    right: Math.max(first.right, second.right),
    bottom: Math.max(first.bottom, second.bottom),
  };
}

export function applyMaskToPixels(sourcePixels, mask) {
  const output = new Uint8ClampedArray(sourcePixels);
  for (let index = 0; index < mask.length; index += 1) {
    const alphaIndex = index * 4 + 3;
    output[alphaIndex] = Math.min(sourcePixels[alphaIndex], mask[index]);
  }
  return output;
}

export function compositePreviewPixels(foregroundPixels, background) {
  const output = new Uint8ClampedArray(foregroundPixels.length);
  for (let index = 0; index < foregroundPixels.length; index += 4) {
    const alpha = foregroundPixels[index + 3];
    if (!background) {
      output.set(foregroundPixels.subarray(index, index + 4), index);
      continue;
    }
    const amount = alpha / 255;
    output[index] = Math.round(
      foregroundPixels[index] * amount + background[0] * (1 - amount),
    );
    output[index + 1] = Math.round(
      foregroundPixels[index + 1] * amount + background[1] * (1 - amount),
    );
    output[index + 2] = Math.round(
      foregroundPixels[index + 2] * amount + background[2] * (1 - amount),
    );
    output[index + 3] = 255;
  }
  return output;
}

export function isPrimaryPointerStart(event, activePointer) {
  return (
    activePointer === null && event.isPrimary !== false && event.button === 0
  );
}

export function createMaskHistory(
  initialMask,
  limit = 20,
  byteLimit = Number.POSITIVE_INFINITY,
  options = {},
) {
  const initial = new Uint8ClampedArray(initialMask);
  let current = options.adoptCurrent
    ? initialMask
    : new Uint8ClampedArray(initial);
  const maximum = Math.max(0, limit - 1);
  const maximumBytes = Math.max(0, byteLimit);
  let entries = [];
  let position = 0;
  let entryBytes = 0;

  const applyEntry = (entry, values) => {
    for (let index = 0; index < entry.indices.length; index += 1)
      current[entry.indices[index]] = values[index];
  };

  const sizeOf = (entry) =>
    entry.indices.byteLength + entry.before.byteLength + entry.after.byteLength;
  const storeEntry = (entry) => {
    if (!entry.indices.length) return false;
    for (const discarded of entries.slice(position))
      entryBytes -= sizeOf(discarded);
    entries = entries.slice(0, position);
    const stored = {
      indices: new Uint32Array(entry.indices),
      before: new Uint8ClampedArray(entry.before),
      after: new Uint8ClampedArray(entry.after),
    };
    entries.push(stored);
    entryBytes += sizeOf(stored);
    applyEntry(stored, stored.after);
    while (entries.length > maximum || entryBytes > maximumBytes) {
      const discarded = entries.shift();
      entryBytes -= sizeOf(discarded);
    }
    position = entries.length;
    return true;
  };

  return {
    current: () => new Uint8ClampedArray(current),
    currentView: () => current,
    canUndo: () => position > 0,
    canRedo: () => position < entries.length,
    commitEntry(entry) {
      if (
        !entry ||
        entry.indices.length !== entry.before.length ||
        entry.indices.length !== entry.after.length
      )
        throw new Error('Invalid mask history entry');
      return storeEntry(entry);
    },
    commit(mask) {
      let count = 0;
      for (let index = 0; index < mask.length; index += 1)
        if (current[index] !== mask[index]) count += 1;
      if (!count) return false;
      const indices = new Uint32Array(count);
      const before = new Uint8ClampedArray(count);
      const after = new Uint8ClampedArray(count);
      let offset = 0;
      for (let index = 0; index < mask.length; index += 1) {
        if (current[index] === mask[index]) continue;
        indices[offset] = index;
        before[offset] = current[index];
        after[offset] = mask[index];
        offset += 1;
      }
      return storeEntry({ indices, before, after });
    },
    undo() {
      if (position > 0) {
        position -= 1;
        applyEntry(entries[position], entries[position].before);
      }
      return this.current();
    },
    redo() {
      if (position < entries.length) {
        applyEntry(entries[position], entries[position].after);
        position += 1;
      }
      return this.current();
    },
    reset() {
      current = new Uint8ClampedArray(initial);
      entries = [];
      position = 0;
      entryBytes = 0;
      return this.current();
    },
    clear() {
      initial.fill(0);
      current.fill(0);
      entries = [];
      position = 0;
      entryBytes = 0;
    },
  };
}

export function createRenderOwnership() {
  let fileVersion = 0;
  let maskRevision = 0;
  let backgroundRevision = 0;
  let cropRevision = 0;
  let requestId = 0;
  let currentToken = null;

  const api = {
    outputBlob: null,
    pending: false,
    select(version) {
      fileVersion = version;
      maskRevision = 0;
      backgroundRevision = 0;
      cropRevision = 0;
      requestId += 1;
      currentToken = null;
      api.outputBlob = null;
      api.pending = false;
    },
    reviseMask() {
      maskRevision += 1;
      requestId += 1;
      currentToken = null;
      api.outputBlob = null;
      api.pending = false;
    },
    reviseBackground() {
      backgroundRevision += 1;
      requestId += 1;
      currentToken = null;
      api.outputBlob = null;
      api.pending = false;
    },
    reviseCrop() {
      cropRevision += 1;
      requestId += 1;
      currentToken = null;
      api.outputBlob = null;
      api.pending = false;
    },
    reviseEffects() {
      backgroundRevision += 1;
      requestId += 1;
      currentToken = null;
      api.outputBlob = null;
      api.pending = false;
    },
    request(background) {
      currentToken = Object.freeze({
        fileVersion,
        maskRevision,
        backgroundRevision,
        cropRevision,
        background,
        requestId: ++requestId,
      });
      api.outputBlob = null;
      api.pending = true;
      return currentToken;
    },
    isCurrent(token) {
      return token === currentToken;
    },
    publish(token, blob) {
      if (!api.isCurrent(token)) return false;
      api.outputBlob = blob;
      api.pending = false;
      return true;
    },
    fail(token) {
      if (!api.isCurrent(token)) return false;
      api.outputBlob = null;
      api.pending = false;
      return true;
    },
  };
  return api;
}
