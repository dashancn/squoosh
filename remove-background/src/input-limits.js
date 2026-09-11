export const MAX_ENCODED_BYTES = 20 * 1024 * 1024;
// 8 MP is the highest whole-megapixel limit with clear headroom in the
// conservative 256 MiB editor allocation inventory in mask-editor.js.
export const MAX_DECODED_PIXELS = 8_000_000;
// A transient decode may hold the browser's source bitmap (~4 B/px), the
// bounded 8 MP resize canvas and encoded input at once. 30 MP keeps that
// inventory below 256 MiB while covering common phone and camera photos.
export const MAX_PRE_RESIZE_PIXELS = 30_000_000;
export const MAX_DIMENSION = 10_000;

export function validateEncodedFile(file) {
  if (!file || !Number.isFinite(file.size) || file.size < 0) {
    throw new Error('无法读取图片文件大小，请重新选择图片');
  }
  if (file.size > MAX_ENCODED_BYTES) {
    throw new Error('图片文件不能超过 20 MiB');
  }
}

function validateDimensionValues(width, height) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error('无法读取图片尺寸，请选择有效的图片文件');
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error('图片宽度和高度均不能超过 10000 像素');
  }
}

export function validateDecodedDimensions(width, height) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error('无法读取图片尺寸，请选择有效的图片文件');
  }
  if (width * height > MAX_DECODED_PIXELS) {
    throw new Error('图片解码后不能超过 800 万像素');
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error('图片宽度和高度均不能超过 10000 像素');
  }
}

export function validatePreResizeDimensions(width, height) {
  validateDimensionValues(width, height);
  if (width * height > MAX_PRE_RESIZE_PIXELS) {
    throw new Error('图片解码后超过预处理安全上限（3000 万像素）');
  }
}

export function processedDimensions(width, height) {
  validatePreResizeDimensions(width, height);
  if (width * height <= MAX_DECODED_PIXELS) return { width, height };
  const scale = Math.sqrt(MAX_DECODED_PIXELS / (width * height));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

export async function decodeValidatedRemovalInput(
  file,
  decode = (candidate) => createImageBitmap(candidate),
) {
  validateEncodedFile(file);

  let bitmap;
  try {
    bitmap = await decode(file);
  } catch {
    throw new Error('无法解码图片，请选择有效的图片文件');
  }

  try {
    validatePreResizeDimensions(bitmap.width, bitmap.height);
    return bitmap;
  } catch (error) {
    bitmap.close?.();
    throw error;
  }
}

export async function decodeAndValidateRemovalInput(file, decode) {
  let bitmap;
  try {
    bitmap = await decodeValidatedRemovalInput(file, decode);
  } finally {
    bitmap?.close?.();
  }
}
