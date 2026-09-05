export const MAX_FILES = 12;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 80 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 30_000_000;
export const MAX_TOTAL_PIXELS = 90_000_000;

export function validateFiles(blobs) {
  if (!Array.isArray(blobs) || blobs.length === 0 || blobs.some((blob) => !(blob instanceof Blob))) {
    throw new Error('At least one image Blob is required');
  }
  if (blobs.length > MAX_FILES) {
    throw new Error(`最多选择 ${MAX_FILES} 张图片`);
  }
  let totalBytes = 0;
  for (const blob of blobs) {
    if (blob.size > MAX_FILE_BYTES) {
      throw new Error('每张图片不能超过 20 MiB');
    }
    totalBytes += blob.size;
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error('所选图片总大小不能超过 80 MiB');
  }
}

export function validateDecodedImage(image, decodedPixels) {
  const pixels = image.width * image.height;
  if (!Number.isSafeInteger(pixels) || pixels <= 0) {
    throw new Error('图片尺寸无效或无法解码');
  }
  if (pixels > MAX_IMAGE_PIXELS) {
    throw new Error('每张图片解码后不能超过 30 MP（3000 万像素）');
  }
  const totalPixels = decodedPixels + pixels;
  if (totalPixels > MAX_TOTAL_PIXELS) {
    throw new Error('全部图片解码后总计不能超过 90 MP（9000 万像素）');
  }
  return totalPixels;
}
