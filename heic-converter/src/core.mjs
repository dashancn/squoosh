export const MAX_FILES = 12;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 80 * 1024 * 1024;
export const MAX_PIXELS = 30_000_000;
export const MAX_EDGE = 10_000;
export const CACHE_KEY = 'i41-heic-decoder-success-v1';

export function hasWebpSignature(bytes) {
  return bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

export function classifyFile(file, heicSignature, webpSignature) {
  if (heicSignature) return 'heic';
  if (webpSignature) return 'webp';
  return 'unsupported';
}

export function validateBatch(files) {
  if (files.length > MAX_FILES) throw new Error(`一次最多选择 ${MAX_FILES} 个文件`);
  let total = 0;
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} 超过 20 MiB`);
    total += file.size;
  }
  if (total > MAX_TOTAL_BYTES) throw new Error('文件总大小超过 80 MiB');
}

export function validateDimensions(width, height) {
  if (width > MAX_EDGE || height > MAX_EDGE) throw new Error('图片边长超过 10000 像素');
  if (width * height > MAX_PIXELS) throw new Error('解码后的图片超过 3000 万像素');
}

export function outputFilename(name, format) {
  const extension = format === 'jpeg' ? 'jpg' : 'png';
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.${extension}`;
}

export function encoderOptions(format, quality, background) {
  if (format === 'png') return { type: 'image/png' };
  return { type: 'image/jpeg', quality: quality / 100, background };
}

export function cyclicIndex(index, delta, length) {
  if (length < 1) return -1;
  return ((index + delta) % length + length) % length;
}

export class VersionOwner {
  #version = 0;
  next() { this.#version += 1; return this.#version; }
  isCurrent(version) { return version === this.#version; }
}

export function readinessMessage(storage) {
  return storage.getItem(CACHE_KEY) === '1'
    ? 'HEIC 解码资源曾成功加载，本次可能可从浏览器缓存快速开始。'
    : '首次转换 HEIC 需加载约 3.0 MB 原始资源（约 0.8 MB 压缩传输），耗时取决于网络，请保持页面打开。';
}
