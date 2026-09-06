import { isHeicBytes, decodeHeic } from '../third-party/heic-to-1.5.2.worker.js';
import { validateDimensions } from './core.mjs';

self.onmessage = async ({ data }) => {
  const { id, operation, file } = data;
  try {
    const buffer = await file.arrayBuffer();
    if (operation === 'inspect') {
      self.postMessage({ id, type: 'result', isHeic: isHeicBytes(buffer) });
      return;
    }
    if (operation !== 'convert') throw new Error('未知的 HEIC worker 操作');
    if (!isHeicBytes(buffer)) throw new Error(`${file.name} 的 HEIC 签名无效`);
    self.postMessage({ id, type: 'progress', message: '正在后台解码 HEIC…' });
    const imageData = await decodeHeic(buffer, validateDimensions);
    const canvas = new OffscreenCanvas(imageData.width, imageData.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法创建后台画布');
    context.putImageData(imageData, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const output = await blob.arrayBuffer();
    canvas.width = 1;
    canvas.height = 1;
    self.postMessage({ id, type: 'result', buffer: output, mimeType: blob.type }, [output]);
  } catch (error) {
    self.postMessage({ id, type: 'error', error: error?.message || String(error) });
  }
};
