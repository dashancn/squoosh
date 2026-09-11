import {
  processedDimensions,
  validateDecodedDimensions,
} from './input-limits.js';

function outputType(input) {
  return /image\/jpe?g/i.test(input.type || '') ? 'image/jpeg' : 'image/png';
}

function canvasBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error('图片优化失败，请重新选择图片')),
      type,
      type === 'image/jpeg' ? 0.92 : undefined,
    );
  });
}

export async function preprocessRemovalInput({
  input,
  bitmap,
  createCanvas = () => document.createElement('canvas'),
  decode = (blob) => createImageBitmap(blob),
}) {
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  const dimensions = processedDimensions(originalWidth, originalHeight);
  if (
    dimensions.width === originalWidth &&
    dimensions.height === originalHeight
  ) {
    validateDecodedDimensions(originalWidth, originalHeight);
    return {
      input,
      bitmap,
      originalWidth,
      originalHeight,
      processedWidth: originalWidth,
      processedHeight: originalHeight,
      optimized: false,
    };
  }

  const canvas = createCanvas();
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  try {
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('浏览器无法创建图片优化画布');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    const type = outputType(input);
    const blob = await canvasBlob(canvas, type);
    const processedInput = new File([blob], input.name, {
      type,
      lastModified: input.lastModified,
    });
    const processedBitmap = await decode(processedInput);
    try {
      validateDecodedDimensions(processedBitmap.width, processedBitmap.height);
    } catch (error) {
      processedBitmap.close?.();
      throw error;
    }
    return {
      input: processedInput,
      bitmap: processedBitmap,
      originalWidth,
      originalHeight,
      processedWidth: processedBitmap.width,
      processedHeight: processedBitmap.height,
      optimized: true,
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
