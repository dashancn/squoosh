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
) {
  const safeRadius = Math.max(0.5, radius);
  const startX = clamp(Math.floor(centerX - safeRadius), 0, width - 1);
  const endX = clamp(Math.ceil(centerX + safeRadius), 0, width - 1);
  const startY = clamp(Math.floor(centerY - safeRadius), 0, height - 1);
  const endY = clamp(Math.ceil(centerY + safeRadius), 0, height - 1);
  const radiusSquared = safeRadius * safeRadius;
  let changed = false;

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 > radiusSquared) continue;
      const index = y * width + x;
      const next = mode === 'restore' ? originalAlpha[index] : 0;
      if (mask[index] === next) continue;
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
  return activePointer === null && event.isPrimary && event.button === 0;
}

export function createMaskHistory(initialMask, limit = 20) {
  const initial = new Uint8ClampedArray(initialMask);
  let current = new Uint8ClampedArray(initial);
  const maximum = Math.max(0, limit - 1);
  let entries = [];
  let position = 0;

  const applyEntry = (entry, values) => {
    for (let index = 0; index < entry.indices.length; index += 1)
      current[entry.indices[index]] = values[index];
  };

  const storeEntry = (entry) => {
    if (!entry.indices.length) return false;
    entries = entries.slice(0, position);
    entries.push({
      indices: new Uint32Array(entry.indices),
      before: new Uint8ClampedArray(entry.before),
      after: new Uint8ClampedArray(entry.after),
    });
    applyEntry(entries.at(-1), entries.at(-1).after);
    if (entries.length > maximum) entries.shift();
    position = entries.length;
    return true;
  };

  return {
    current: () => new Uint8ClampedArray(current),
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
      return this.current();
    },
    clear() {
      initial.fill(0);
      current.fill(0);
      entries = [];
      position = 0;
    },
  };
}

export function createRenderOwnership() {
  let fileVersion = 0;
  let maskRevision = 0;
  let backgroundRevision = 0;
  let requestId = 0;
  let currentToken = null;

  const api = {
    outputBlob: null,
    pending: false,
    select(version) {
      fileVersion = version;
      maskRevision = 0;
      backgroundRevision = 0;
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
    request(background) {
      currentToken = Object.freeze({
        fileVersion,
        maskRevision,
        backgroundRevision,
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
