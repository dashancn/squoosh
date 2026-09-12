function waitForImageLoad(image) {
  return new Promise((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('图片元素无法解码'));
  });
}

export async function decodeBrowserImage(
  blob,
  {
    createImageBitmap: createBitmap = globalThis.createImageBitmap?.bind(
      globalThis,
    ),
    createImage = () => new Image(),
    createCanvas = () => document.createElement('canvas'),
    createObjectURL = (candidate) => URL.createObjectURL(candidate),
    revokeObjectURL = (url) => URL.revokeObjectURL(url),
  } = {},
) {
  if (typeof createBitmap === 'function') {
    try {
      return await createBitmap(blob);
    } catch {
      // Safari exposes createImageBitmap for some inputs but may reject valid files.
    }
  }

  const image = createImage();
  const url = createObjectURL(blob);
  const loaded = waitForImageLoad(image);
  image.src = url;
  try {
    if (typeof image.decode === 'function') {
      try {
        await image.decode();
      } catch {
        if (!(image.complete && image.naturalWidth > 0)) await loaded;
      }
    } else {
      await loaded;
    }
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0
    )
      throw new Error('无法读取图片尺寸');
    const canvas = createCanvas();
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('浏览器无法创建图片画布');
    context.drawImage(image, 0, 0);
    Object.defineProperty(canvas, 'close', {
      configurable: true,
      value() {
        canvas.width = 0;
        canvas.height = 0;
      },
    });
    return canvas;
  } finally {
    image.onload = null;
    image.onerror = null;
    image.src = '';
    revokeObjectURL(url);
  }
}
