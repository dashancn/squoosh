const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

export function toSourcePoint(clientX, clientY, rect, width, height) {
  return {
    x: clamp(((clientX - rect.left) / rect.width) * width, 0, width - 1),
    y: clamp(((clientY - rect.top) / rect.height) * height, 0, height - 1),
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
) {
  const safeRadius = Math.max(0.5, radius);
  const startX = clamp(Math.floor(centerX - safeRadius), 0, width - 1);
  const endX = clamp(Math.ceil(centerX + safeRadius), 0, width - 1);
  const startY = clamp(Math.floor(centerY - safeRadius), 0, height - 1);
  const endY = clamp(Math.ceil(centerY + safeRadius), 0, height - 1);
  const radiusSquared = safeRadius * safeRadius;

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const distanceSquared = (x - centerX) ** 2 + (y - centerY) ** 2;
      if (distanceSquared > radiusSquared) continue;
      const index = y * width + x;
      mask[index] = mode === 'restore' ? originalAlpha[index] : 0;
    }
  }
  return mask;
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

export function createMaskHistory(initialMask, limit = 20) {
  const initial = new Uint8ClampedArray(initialMask);
  let snapshots = [new Uint8ClampedArray(initial)];
  let position = 0;

  return {
    current: () => new Uint8ClampedArray(snapshots[position]),
    canUndo: () => position > 0,
    canRedo: () => position < snapshots.length - 1,
    commit(mask) {
      snapshots = snapshots.slice(0, position + 1);
      snapshots.push(new Uint8ClampedArray(mask));
      if (snapshots.length > Math.max(2, limit)) snapshots.shift();
      position = snapshots.length - 1;
      return this.current();
    },
    undo() {
      if (position > 0) position -= 1;
      return this.current();
    },
    redo() {
      if (position < snapshots.length - 1) position += 1;
      return this.current();
    },
    reset() {
      snapshots = [new Uint8ClampedArray(initial)];
      position = 0;
      return this.current();
    },
  };
}
