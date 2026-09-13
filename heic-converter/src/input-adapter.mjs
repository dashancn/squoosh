import { HeicWorkerClient } from './heic-worker-client.mjs';
import { MAX_FILE_BYTES, validateDimensions } from './core.mjs';

const HEIC_BRANDS = new Set([
  'mif1', 'msf1', 'heic', 'heix', 'hevc', 'hevx',
  'heim', 'heis', 'hevm', 'hevs',
]);
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
let sharedClient;

function boundedDimensions(width, height, maxPixels) {
  if (!Number.isFinite(maxPixels) || width * height <= maxPixels) return { width, height };
  const scale = Math.sqrt(maxPixels / (width * height));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

function retryDimensions(width, height, outputBytes, maxOutputBytes) {
  const ratio = Math.min(0.9, Math.sqrt((maxOutputBytes * 0.9) / outputBytes));
  return {
    width: Math.max(1, Math.floor(width * ratio)),
    height: Math.max(1, Math.floor(height * ratio)),
  };
}

export function heicCandidateFromHeader(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return false;
  if (String.fromCharCode(...bytes.subarray(4, 8)) !== 'ftyp') return false;
  const brand = new TextDecoder('utf-8')
    .decode(bytes.subarray(8, 12))
    .replace('\0', ' ')
    .trim();
  return HEIC_BRANDS.has(brand);
}

export function pngFilename(name) {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.png`;
}

function defaultCreateClient() {
  sharedClient ||= new HeicWorkerClient({
    workerUrl: new URL('/heic-converter/src/heic-worker.mjs', location.origin),
  });
  return sharedClient;
}

function verifyPng(buffer, mimeType) {
  if (mimeType !== 'image/png' || !(buffer instanceof ArrayBuffer) || buffer.byteLength < 8) {
    throw new Error('HEIC 解码器未返回有效 PNG');
  }
  const signature = new Uint8Array(buffer, 0, 8);
  if (!PNG_SIGNATURE.every((value, index) => signature[index] === value)) {
    throw new Error('HEIC 解码器未返回有效 PNG');
  }
}

export async function normalizeImageFile(file, {
  createClient = defaultCreateClient,
  limits = {
    maxFileBytes: MAX_FILE_BYTES,
    maxPixels: 30_000_000,
    maxEdge: 10_000,
    maxOutputBytes: Number.POSITIVE_INFINITY,
  },
} = {}) {
  if (!file || !Number.isFinite(file.size) || file.size < 0) {
    throw new Error('无法读取图片文件大小，请重新选择图片');
  }
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name || '图片'} 超过 20 MiB`);
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!heicCandidateFromHeader(header)) return file;
  if (file.size > limits.maxFileBytes) {
    if (limits.maxFileBytes === 8 * 1024 * 1024)
      throw new Error('HEIC 文件不能超过 8 MiB');
    throw new Error(`${file.name || 'HEIC 图片'} 超过文件大小限制`);
  }

  const client = createClient();
  const inspection = await client.inspect(file);
  if (!inspection.isHeic) throw new Error(`${file.name} 的 HEIC/HEIF 签名无效`);
  if (!Number.isSafeInteger(inspection.width) || !Number.isSafeInteger(inspection.height) || inspection.width <= 0 || inspection.height <= 0)
    throw new Error('无法可靠读取 HEIC 图片尺寸');
  if (inspection.width > limits.maxEdge || inspection.height > limits.maxEdge)
    throw new Error('HEIC 图片边长超过 10000 像素');
  if (inspection.width * inspection.height > limits.maxPixels) {
    if (limits.maxPixels === 8_000_000) throw new Error('HEIC 图片不能超过 800 万像素');
    validateDimensions(inspection.width, inspection.height);
  }
  const requested = boundedDimensions(
    inspection.width,
    inspection.height,
    limits.targetPixels ?? limits.maxPixels,
  );
  const maxOutputPixels = limits.targetPixels ?? limits.maxPixels;
  let converted = await client.convert(file, { ...requested, maxOutputPixels });
  verifyPng(converted.buffer, converted.mimeType);
  if (converted.buffer.byteLength > limits.maxOutputBytes) {
    const retry = retryDimensions(
      converted.width ?? requested.width,
      converted.height ?? requested.height,
      converted.buffer.byteLength,
      limits.maxOutputBytes,
    );
    converted = null;
    converted = await client.convert(file, { ...retry, maxOutputPixels });
    verifyPng(converted.buffer, converted.mimeType);
  }
  const { buffer, mimeType, width = requested.width, height = requested.height } = converted;
  if (buffer.byteLength > limits.maxOutputBytes)
    throw new Error('HEIC 图片已自动缩小，但转换结果仍超过 8 MiB');
  limits.resourceInventory?.({
    width: inspection.width,
    height: inspection.height,
    outputWidth: width,
    outputHeight: height,
    originalEncodedBytes: file.size,
    convertedEncodedBytes: buffer.byteLength,
  });
  return new File([buffer], pngFilename(file.name), {
    type: 'image/png',
    lastModified: file.lastModified,
  });
}

export async function normalizeImageFiles(files, options) {
  const normalized = [];
  for (const file of files) normalized.push(await normalizeImageFile(file, options));
  return normalized;
}

export function terminateSharedHeicDecoder() {
  sharedClient?.terminate();
  sharedClient = undefined;
}
