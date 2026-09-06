import buildLibheif from '../node_modules/heic-to/src/lib/libheif-without-unsafe-eval.js';

const brands = new Set(['mif1', 'msf1', 'heic', 'heix', 'hevc', 'hevx']);
let libheif;

export function isHeicBytes(buffer) {
  if (buffer.byteLength < 12) return false;
  const brand = new TextDecoder('utf-8').decode(buffer.slice(8, 12)).replace('\0', ' ').trim();
  return brands.has(brand);
}

function openHeic(buffer) {
  if (!libheif) libheif = buildLibheif();
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(buffer);
  if (!images.length) {
    if (decoder.decoder) libheif.heif_context_free(decoder.decoder);
    throw new Error('HEIF image not found');
  }
  return { decoder, images, image: images[0], width: images[0].get_width(), height: images[0].get_height() };
}

function closeHeic({ decoder, images }) {
  for (const image of images) image.free();
  if (decoder?.decoder) libheif.heif_context_free(decoder.decoder);
}

export function inspectHeic(buffer) {
  const opened = openHeic(buffer);
  try { return { width: opened.width, height: opened.height }; }
  finally { closeHeic(opened); }
}

export async function decodeHeic(buffer, validateDimensions = () => {}) {
  const opened = openHeic(buffer);
  try {
    const { image, width, height } = opened;
    validateDimensions(width, height);
    const imageData = new ImageData(width, height);
    for (let index = 3; index < imageData.data.length; index += 4) imageData.data[index] = 255;
    return await new Promise((resolve, reject) => image.display(imageData, (data) => data ? resolve(data) : reject(new Error('HEIF processing error'))));
  } finally {
    closeHeic(opened);
  }
}
