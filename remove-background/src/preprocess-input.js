import {
  preprocessingMemoryInventory,
  processedDimensions,
  validateDecodedDimensions,
} from './input-limits.js';
import { decodeBrowserImage } from './browser-image-decode.js';

const JPEG_MARKER_PREFIXES = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  0xc4, 0xcc, 0xdb, 0xdd, 0xda, 0xdc, 0xde, 0xdf, 0xe0, 0xe1, 0xe2, 0xe3, 0xe4,
  0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xee, 0xef, 0xfe,
]);

async function isJpeg(input) {
  if (!input || typeof input.slice !== 'function') return false;
  const header = new Uint8Array(await input.slice(0, 4).arrayBuffer());
  return (
    header.length === 4 &&
    header[0] === 0xff &&
    header[1] === 0xd8 &&
    header[2] === 0xff &&
    JPEG_MARKER_PREFIXES.has(header[3])
  );
}

function outputName(name, type) {
  const extension = type === 'image/jpeg' ? '.jpg' : '.png';
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}${extension}`;
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
  decode = decodeBrowserImage,
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
    const type = (await isJpeg(input)) ? 'image/jpeg' : 'image/png';
    const blob = await canvasBlob(canvas, type);
    preprocessingMemoryInventory({
      sourceWidth: originalWidth,
      sourceHeight: originalHeight,
      processedWidth: dimensions.width,
      processedHeight: dimensions.height,
      originalEncodedBytes: input.size,
      processedEncodedBytes: blob.size,
    });
    const processedInput = new File([blob], outputName(input.name, type), {
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
