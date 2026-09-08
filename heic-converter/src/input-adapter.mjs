import { HeicWorkerClient } from './heic-worker-client.mjs';
import { MAX_FILE_BYTES, validateDimensions } from './core.mjs';

const HEIC_BRANDS = new Set([
  'mif1', 'msf1', 'heic', 'heix', 'hevc', 'hevx',
  'heim', 'heis', 'hevm', 'hevs',
]);
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
let sharedClient;

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

export async function normalizeImageFile(file, { createClient = defaultCreateClient } = {}) {
  if (!file || !Number.isFinite(file.size) || file.size < 0) {
    throw new Error('无法读取图片文件大小，请重新选择图片');
  }
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name || '图片'} 超过 20 MiB`);
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!heicCandidateFromHeader(header)) return file;

  const client = createClient();
  const inspection = await client.inspect(file);
  if (!inspection.isHeic) throw new Error(`${file.name} 的 HEIC/HEIF 签名无效`);
  validateDimensions(inspection.width, inspection.height);
  const { buffer, mimeType } = await client.convert(file);
  verifyPng(buffer, mimeType);
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
