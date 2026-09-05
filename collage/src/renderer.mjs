import { calculateLayout } from './layout.mjs';
import { validateFiles, validateDecodedImage } from './limits.mjs';

function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob && blob.size > 0
          ? resolve(blob)
          : reject(new Error('canvas.toBlob produced an empty PNG')),
      'image/png',
    );
  });
}

export function calculateCoverCrop(bitmap, item, transform = {}) {
  const scale = Math.max(item.width / bitmap.width, item.height / bitmap.height);
  const zoom = Math.max(1, Math.min(8, Number(transform.zoom) || 1));
  const sourceWidth = item.width / scale / zoom;
  const sourceHeight = item.height / scale / zoom;
  const x = Math.max(0, Math.min(1, Number.isFinite(Number(transform.x)) ? Number(transform.x) : 0.5));
  const y = Math.max(0, Math.min(1, Number.isFinite(Number(transform.y)) ? Number(transform.y) : 0.5));
  return {
    sourceX: (bitmap.width - sourceWidth) * x,
    sourceY: (bitmap.height - sourceHeight) * y,
    sourceWidth,
    sourceHeight,
  };
}

function drawCover(context, bitmap, item, transform) {
  const { sourceX, sourceY, sourceWidth, sourceHeight } = calculateCoverCrop(bitmap, item, transform || item.focal);
  context.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    item.x,
    item.y,
    item.width,
    item.height,
  );
}

export async function createCollage(blobs, options = {}) {
  validateFiles(blobs);

  const bitmaps = [];
  let decodedPixels = 0;
  try {
    for (const blob of blobs) {
      const bitmap = await createImageBitmap(blob);
      try {
        decodedPixels = validateDecodedImage(bitmap, decodedPixels);
      } catch (error) {
        bitmap.close();
        throw error;
      }
      bitmaps.push(bitmap);
    }

    const layout = calculateLayout(bitmaps, options);
    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('2D canvas is unavailable');

    context.fillStyle = typeof options.background === 'string' ? options.background : '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    bitmaps.forEach((bitmap, index) => {
      const item = layout.items[index];
      if (item.fit === 'cover') drawCover(context, bitmap, item, options.transforms?.[index]);
      else context.drawImage(bitmap, item.x, item.y, item.width, item.height);
    });

    const blob = await canvasToPng(canvas);
    return { blob, width: canvas.width, height: canvas.height, layout };
  } finally {
    bitmaps.forEach((bitmap) => bitmap.close());
  }
}
