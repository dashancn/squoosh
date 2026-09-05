export const MAX_ENCODED_BYTES = 20 * 1024 * 1024;
export const MAX_DECODED_PIXELS = 30_000_000;
export const MAX_DIMENSION = 10_000;

export function validateEncodedFile(file) {
  if (!file || !Number.isFinite(file.size) || file.size < 0) {
    throw new Error('无法读取图片文件大小，请重新选择图片');
  }
  if (file.size > MAX_ENCODED_BYTES) {
    throw new Error('图片文件不能超过 20 MiB');
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
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error('图片宽度和高度均不能超过 10000 像素');
  }
  if (width * height > MAX_DECODED_PIXELS) {
    throw new Error('图片解码后不能超过 3000 万像素');
  }
}

export async function decodeAndValidateRemovalInput(
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
    validateDecodedDimensions(bitmap.width, bitmap.height);
  } finally {
    bitmap.close?.();
  }
}
