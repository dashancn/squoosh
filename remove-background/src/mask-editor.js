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

export function normalizeAspectCropRect(start, end, width, height, ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0)
    return normalizeCropRect(start, end, width, height);
  const sx = clamp(start.x, 0, width - 1);
  const sy = clamp(start.y, 0, height - 1);
  const signX = end.x < sx ? -1 : 1;
  const signY = end.y < sy ? -1 : 1;
  const availableWidth = signX > 0 ? width - sx : sx;
  const availableHeight = signY > 0 ? height - sy : sy;
  let cropWidth = Math.min(Math.abs(end.x - sx), availableWidth);
  let cropHeight = Math.min(Math.abs(end.y - sy), availableHeight);
  if (cropWidth / Math.max(1, cropHeight) > ratio)
    cropWidth = cropHeight * ratio;
  else cropHeight = cropWidth / ratio;
  cropWidth = Math.max(
    1,
    Math.floor(Math.min(cropWidth, availableHeight * ratio)),
  );
  cropHeight = Math.max(1, Math.round(cropWidth / ratio));
  if (cropHeight > availableHeight) {
    cropHeight = Math.max(1, Math.floor(availableHeight));
    cropWidth = Math.max(1, Math.round(cropHeight * ratio));
  }
  return {
    x: Math.floor(signX > 0 ? sx : sx - cropWidth),
    y: Math.floor(signY > 0 ? sy : sy - cropHeight),
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
  const cleanupStrength =
    options.cleanup === 'medium'
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
  const brightness =
    clamp(Number(adjustments.brightness) || 0, -100, 100) * 2.55;
  const contrastValue = clamp(Number(adjustments.contrast) || 0, -100, 100);
  const contrast =
    (259 * (contrastValue + 255)) / (255 * (259 - contrastValue));
  const saturation =
    1 + clamp(Number(adjustments.saturation) || 0, -100, 100) / 100;
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
      const next = Math.round(
        mode === 'restore'
          ? mask[index] + (originalAlpha[index] - mask[index]) * strength
          : mask[index] * (1 - strength),
      );
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
  return (
    activePointer === null && event.isPrimary !== false && event.button === 0
  );
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
