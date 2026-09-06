export async function handleHeicWorkerMessage(data, dependencies) {
  const {
    isHeicBytes,
    inspectHeic,
    decodeHeic,
    validateDimensions,
    createCanvas,
    postMessage,
  } = dependencies;
  const { id, operation, file } = data;
  try {
    const buffer = await file.arrayBuffer();
    if (operation === 'inspect') {
      if (!isHeicBytes(buffer)) {
        postMessage({ id, type: 'result', isHeic: false });
        return;
      }
      const { width, height } = inspectHeic(buffer);
      validateDimensions(width, height);
      postMessage({ id, type: 'result', isHeic: true, width, height });
      return;
    }
    if (operation !== 'convert') throw new Error('未知的 HEIC worker 操作');
    if (!isHeicBytes(buffer)) throw new Error(`${file.name} 的 HEIC 签名无效`);
    postMessage({ id, type: 'progress', message: '正在后台解码 HEIC…' });
    const imageData = await decodeHeic(buffer, validateDimensions);
    const canvas = createCanvas(imageData.width, imageData.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法创建后台画布');
    context.putImageData(imageData, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    if (blob.type !== 'image/png') throw new Error('浏览器未生成有效 PNG');
    const output = await blob.arrayBuffer();
    const signature = new Uint8Array(output, 0, Math.min(8, output.byteLength));
    if (
      output.byteLength < 8 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every(
        (value, index) => signature[index] === value,
      )
    )
      throw new Error('浏览器未生成有效 PNG');
    canvas.width = 1;
    canvas.height = 1;
    postMessage({ id, type: 'result', buffer: output, mimeType: 'image/png' }, [
      output,
    ]);
  } catch (error) {
    postMessage({ id, type: 'error', error: error?.message || String(error) });
  }
}
