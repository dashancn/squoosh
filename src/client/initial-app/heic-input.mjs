export const MAX_HEIC_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_HEIC_PIXELS = 30_000_000;
export const MAX_HEIC_EDGE = 10_000;
export const HEIC_CACHE_KEY = 'i41-compressor-heic-success-v1';

const HEIC_BRANDS = new Set(['mif1', 'msf1', 'heic', 'heix', 'hevc', 'hevx']);
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function hasHeicFtypSignature(bytes) {
  if (bytes.length < 12) return false;
  if (
    bytes[4] !== 0x66 ||
    bytes[5] !== 0x74 ||
    bytes[6] !== 0x79 ||
    bytes[7] !== 0x70
  )
    return false;
  const brand = String.fromCharCode(...bytes.subarray(8, 12));
  return HEIC_BRANDS.has(brand);
}

export function pngFilenameFor(name) {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.png`;
}

export function hasPngSignature(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < PNG_SIGNATURE.length)
    return false;
  const bytes = new Uint8Array(buffer, 0, PNG_SIGNATURE.length);
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

async function decodePng(buffer) {
  const bitmap = await createImageBitmap(new Blob([buffer], { type: 'image/png' }));
  bitmap.close();
}

export function validateHeicFileSize(size) {
  if (size > MAX_HEIC_FILE_BYTES)
    throw new Error('HEIC 文件超过 20 MiB，请先缩小文件后重试');
}

export function validateHeicDimensions(width, height) {
  if (width > MAX_HEIC_EDGE || height > MAX_HEIC_EDGE)
    throw new Error('HEIC 图片边长超过 10000 像素');
  if (width * height > MAX_HEIC_PIXELS)
    throw new Error('解码后的 HEIC 图片超过 3000 万像素');
}

function friendlyHeicError(error) {
  const message = error?.message || String(error);
  if (/20 MiB|10000|3000 万/.test(message)) return message;
  if (/签名|valid|not found/i.test(message))
    return '不是有效的 HEIC/HEIF 文件，请检查文件后重试';
  if (/资源不可用|network|load|fetch/i.test(message))
    return 'HEIC 解码资源不可用，请检查网络后刷新重试';
  if (/超时/.test(message)) return 'HEIC 解码超时，请保持页面打开后重试';
  if (/memory|内存|allocation/i.test(message))
    return 'HEIC 解码内存不足，请关闭其他页面或换用更小的图片';
  return 'HEIC 解码失败，请检查文件或可用内存后重试';
}

export class CompressorHeicInput {
  constructor({
    createWorkerClient,
    openFile,
    setNotice = () => {},
    FileClass = globalThis.File,
    storage = globalThis.localStorage,
    decodePng: decodePngOutput = decodePng,
  }) {
    this.createWorkerClient = createWorkerClient;
    this.openFile = openFile;
    this.setNotice = setNotice;
    this.FileClass = FileClass;
    this.storage = storage;
    this.decodePng = decodePngOutput;
    this.worker = undefined;
    this.version = 0;
  }

  async select(file) {
    const version = ++this.version;
    if (this.worker) this.worker.terminate();
    this.worker = undefined;
    let worker;
    try {
      const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      if (version !== this.version) return;
      if (!hasHeicFtypSignature(head)) {
        if (
          /\.(?:heic|heif)$/i.test(file.name) ||
          /image\/hei[cf]/i.test(file.type || '')
        ) {
          this.setNotice({
            kind: 'error',
            message: '不是有效的 HEIC/HEIF 文件：未检测到真实 ftyp 签名',
          });
          return;
        }
        this.setNotice(null);
        this.openFile(file);
        return;
      }
      validateHeicFileSize(file.size);
      const cached = this.storage?.getItem?.(HEIC_CACHE_KEY) === '1';
      this.setNotice({
        kind: 'loading',
        message: cached
          ? '正在后台准备 HEIC 解码；资源曾成功加载，本次可能从浏览器缓存快速开始。请保持页面打开。'
          : '正在后台加载 HEIC 解码资源；首次约 3.0 MB 原始资源（约 0.8 MB 压缩传输），耗时取决于网络，请保持页面打开。',
      });
      worker = await this.createWorkerClient((message) => {
        if (version === this.version)
          this.setNotice({ kind: 'loading', message });
      });
      if (version !== this.version) {
        worker.terminate();
        return;
      }
      this.worker = worker;
      const inspection = await worker.inspect(file);
      if (version !== this.version) return;
      if (!inspection.isHeic) throw new Error('HEIC 签名无效');
      validateHeicDimensions(inspection.width, inspection.height);
      const { buffer, mimeType } = await worker.convert(file);
      if (version !== this.version) return;
      if (mimeType !== 'image/png' || !hasPngSignature(buffer))
        throw new Error('HEIC worker 未返回有效 PNG');
      await this.decodePng(buffer);
      if (version !== this.version) return;
      const output = new this.FileClass([buffer], pngFilenameFor(file.name), {
        type: 'image/png',
      });
      this.storage?.setItem?.(HEIC_CACHE_KEY, '1');
      this.setNotice({
        kind: 'success',
        message:
          'HEIC 已在本地解码为 PNG 并进入压缩器；原始元数据/EXIF 可能不会保留。解码使用 heic-to、libheif 与 libde265（LGPL-3.0）。',
      });
      this.openFile(output);
    } catch (error) {
      if (version !== this.version) return;
      console.error('HEIC conversion failed', error);
      this.setNotice({ kind: 'error', message: friendlyHeicError(error) });
    } finally {
      if (worker && this.worker === worker) {
        worker.terminate();
        this.worker = undefined;
      }
    }
  }

  cancel() {
    ++this.version;
    if (this.worker) this.worker.terminate();
    this.worker = undefined;
  }
}
