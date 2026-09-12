export async function handleHeicWorkerMessage(data, dependencies) {
  const {
    isHeicBytes,
    inspectHeic,
    decodeHeic,
    validateDimensions,
    createCanvas,
    postMessage,
  } = dependencies;
  const { id, operation, file, width: targetWidth, height: targetHeight } = data;
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
    if (
      !imageData ||
      !Number.isSafeInteger(imageData.width) ||
      !Number.isSafeInteger(imageData.height) ||
      imageData.width <= 0 ||
      imageData.height <= 0 ||
      !(imageData.data instanceof Uint8ClampedArray) ||
      imageData.data.length !== imageData.width * imageData.height * 4
    )
      throw new Error('HEIC 解码器返回了无效像素');
    validateDimensions(imageData.width, imageData.height);
    let output = imageData;
    const requestedResize = targetWidth !== undefined || targetHeight !== undefined;
    if (requestedResize) {
      if (
        !Number.isSafeInteger(targetWidth) ||
        !Number.isSafeInteger(targetHeight) ||
        targetWidth <= 0 ||
        targetHeight <= 0 ||
        targetWidth > imageData.width ||
        targetHeight > imageData.height ||
        targetWidth > 10_000 ||
        targetHeight > 10_000 ||
        targetWidth * targetHeight > 8_000_000
      )
        throw new Error('HEIC 转换尺寸超过安全限制');
    }
    if (
      Number.isSafeInteger(targetWidth) &&
      Number.isSafeInteger(targetHeight) &&
      targetWidth > 0 &&
      targetHeight > 0 &&
      (targetWidth !== imageData.width || targetHeight !== imageData.height)
    ) {
      const scaled = new Uint8ClampedArray(targetWidth * targetHeight * 4);
      for (let y = 0; y < targetHeight; y += 1) {
        const sourceY = Math.min(imageData.height - 1, Math.floor(y * imageData.height / targetHeight));
        for (let x = 0; x < targetWidth; x += 1) {
          const sourceX = Math.min(imageData.width - 1, Math.floor(x * imageData.width / targetWidth));
          const source = (sourceY * imageData.width + sourceX) * 4;
          const destination = (y * targetWidth + x) * 4;
          scaled[destination] = imageData.data[source];
          scaled[destination + 1] = imageData.data[source + 1];
          scaled[destination + 2] = imageData.data[source + 2];
          scaled[destination + 3] = imageData.data[source + 3];
        }
      }
      output = { width: targetWidth, height: targetHeight, data: scaled };
    }
    const canvas = createCanvas?.(output.width, output.height);
    if (!canvas) {
      postMessage(
        { id, type: 'pixels', buffer: output.data.buffer, width: output.width, height: output.height },
        [output.data.buffer],
      );
      return;
    }
    try {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器无法创建后台画布');
      const drawable =
        typeof ImageData !== 'function' || output instanceof ImageData
          ? output
          : new ImageData(output.data, output.width, output.height);
      context.putImageData(drawable, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      if (blob.type !== 'image/png') throw new Error('浏览器未生成有效 PNG');
      const encoded = await blob.arrayBuffer();
      const signature = new Uint8Array(encoded, 0, Math.min(8, encoded.byteLength));
      if (
        encoded.byteLength < 8 ||
        ![137, 80, 78, 71, 13, 10, 26, 10].every(
          (value, index) => signature[index] === value,
        )
      )
        throw new Error('浏览器未生成有效 PNG');
      postMessage(
        { id, type: 'result', buffer: encoded, mimeType: 'image/png', width: output.width, height: output.height },
        [encoded],
      );
    } finally {
      canvas.width = 1;
      canvas.height = 1;
    }
  } catch (error) {
    postMessage({ id, type: 'error', error: error?.message || String(error) });
  }
}
