const HEADER_READ_LIMIT = 1024 * 1024;
const MAX_PRE_RESIZE_PIXELS = 30_000_000;
const MAX_DIMENSION = 10_000;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const AVIF_BRANDS = new Set(['avif', 'avis']);
const error = () =>
  new Error(
    '无法从文件头可靠读取图片格式和尺寸，请选择有效的 JPEG、PNG、WebP 或 AVIF 图片',
  );

function u16(bytes, offset, little = false) {
  if (offset < 0 || offset + 2 > bytes.length) throw error();
  return little
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}
function u24le(bytes, offset) {
  if (offset < 0 || offset + 3 > bytes.length) throw error();
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}
function u32(bytes, offset, little = false) {
  if (offset < 0 || offset + 4 > bytes.length) throw error();
  return little
    ? (bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)) >>>
        0
    : (bytes[offset] * 0x1000000 +
        ((bytes[offset + 1] << 16) |
          (bytes[offset + 2] << 8) |
          bytes[offset + 3])) >>>
        0;
}
function text(bytes, offset, length) {
  if (offset < 0 || offset + length > bytes.length) throw error();
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
function requireBytes(offset, length, end) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    !Number.isSafeInteger(end) ||
    offset < 0 ||
    length < 0 ||
    offset + length > end
  )
    throw error();
}
function boundedU16(bytes, offset, end) {
  requireBytes(offset, 2, end);
  return u16(bytes, offset);
}
function boundedU32(bytes, offset, end) {
  requireBytes(offset, 4, end);
  return u32(bytes, offset);
}
function crc32(bytes, start, end) {
  requireBytes(start, end - start, bytes.length);
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc ^= bytes[offset];
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function dimensions(format, encodedWidth, encodedHeight, orientation = 1) {
  if (
    !Number.isSafeInteger(encodedWidth) ||
    !Number.isSafeInteger(encodedHeight) ||
    encodedWidth <= 0 ||
    encodedHeight <= 0
  )
    throw error();
  const swapped = orientation >= 5 && orientation <= 8;
  return {
    format,
    encodedWidth,
    encodedHeight,
    width: swapped ? encodedHeight : encodedWidth,
    height: swapped ? encodedWidth : encodedHeight,
    orientation,
  };
}

function parseExifOrientation(bytes, start, end) {
  if (end - start < 14 || text(bytes, start, 6) !== 'Exif\0\0') return null;
  const tiff = start + 6;
  const endian = text(bytes, tiff, 2);
  if (endian !== 'II' && endian !== 'MM') throw error();
  const little = endian === 'II';
  if (u16(bytes, tiff + 2, little) !== 42) throw error();
  const ifd = tiff + u32(bytes, tiff + 4, little);
  if (ifd < tiff + 8 || ifd + 2 > end) throw error();
  const count = u16(bytes, ifd, little);
  if (ifd + 2 + count * 12 + 4 > end) throw error();
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (u16(bytes, entry, little) !== 0x0112) continue;
    if (
      u16(bytes, entry + 2, little) !== 3 ||
      u32(bytes, entry + 4, little) !== 1
    )
      throw error();
    const value = u16(bytes, entry + 8, little);
    if (value < 1 || value > 8) throw error();
    return value;
  }
  return null;
}

function parseJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw error();
  let offset = 2;
  let orientation = 1;
  let hasExifOrientation = false;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) throw error();
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) throw error();
    if (
      marker === 0x00 ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7)
    )
      continue;
    const length = u16(bytes, offset);
    if (length < 2 || offset + length > bytes.length) throw error();
    const payload = offset + 2;
    const end = offset + length;
    if (marker === 0xe1 && !hasExifOrientation) {
      const parsedOrientation = parseExifOrientation(bytes, payload, end);
      if (parsedOrientation !== null) {
        orientation = parsedOrientation;
        hasExifOrientation = true;
      }
    }
    if (JPEG_SOF.has(marker)) {
      if (length < 8 || bytes[payload] === 0) throw error();
      return dimensions(
        'jpeg',
        u16(bytes, payload + 3),
        u16(bytes, payload + 1),
        orientation,
      );
    }
    offset = end;
  }
  throw error();
}

function parsePng(bytes) {
  if (
    bytes.length < 33 ||
    !PNG_SIGNATURE.every((value, index) => bytes[index] === value)
  )
    throw error();
  if (u32(bytes, 8) !== 13 || text(bytes, 12, 4) !== 'IHDR') throw error();
  if (crc32(bytes, 12, 29) !== u32(bytes, 29)) throw error();
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const legalBitDepths = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (
    !legalBitDepths[colorType]?.includes(bitDepth) ||
    bytes[26] !== 0 ||
    bytes[27] !== 0 ||
    bytes[28] > 1
  )
    throw error();
  return dimensions('png', u32(bytes, 16), u32(bytes, 20));
}

function parseWebp(bytes, fileSize) {
  if (
    bytes.length < 20 ||
    text(bytes, 0, 4) !== 'RIFF' ||
    text(bytes, 8, 4) !== 'WEBP'
  )
    throw error();
  const riffEnd = u32(bytes, 4, true) + 8;
  if (riffEnd > fileSize || riffEnd < 20) throw error();
  let offset = 12;
  while (offset + 8 <= bytes.length && offset + 8 <= riffEnd) {
    const kind = text(bytes, offset, 4);
    const chunkSize = u32(bytes, offset + 4, true);
    const payload = offset + 8;
    const chunkEnd = payload + chunkSize;
    const paddedEnd = chunkEnd + (chunkSize & 1);
    if (
      !Number.isSafeInteger(paddedEnd) ||
      chunkEnd > riffEnd ||
      paddedEnd > riffEnd
    )
      throw error();
    if (kind === 'VP8X') {
      if (chunkSize !== 10 || chunkEnd > bytes.length) throw error();
      return dimensions(
        'webp',
        u24le(bytes, payload + 4) + 1,
        u24le(bytes, payload + 7) + 1,
      );
    }
    if (kind === 'VP8L') {
      if (
        chunkSize < 5 ||
        payload + 5 > bytes.length ||
        bytes[payload] !== 0x2f
      )
        throw error();
      const bits = u32(bytes, payload + 1, true);
      return dimensions(
        'webp',
        (bits & 0x3fff) + 1,
        ((bits >>> 14) & 0x3fff) + 1,
      );
    }
    if (kind === 'VP8 ') {
      if (
        chunkSize < 10 ||
        payload + 10 > bytes.length ||
        bytes[payload + 3] !== 0x9d ||
        bytes[payload + 4] !== 0x01 ||
        bytes[payload + 5] !== 0x2a
      )
        throw error();
      return dimensions(
        'webp',
        u16(bytes, payload + 6, true) & 0x3fff,
        u16(bytes, payload + 8, true) & 0x3fff,
      );
    }
    if (paddedEnd > bytes.length) throw error();
    offset = paddedEnd;
  }
  throw error();
}

function boxes(bytes, start, end) {
  const result = [];
  let offset = start;
  while (offset < end) {
    if (offset + 8 > end) throw error();
    let size = u32(bytes, offset);
    const type = text(bytes, offset + 4, 4);
    let header = 8;
    if (size === 1) throw error();
    if (size === 0) size = end - offset;
    if (size < header || offset + size > end) throw error();
    result.push({ type, start: offset + header, end: offset + size });
    offset += size;
  }
  return result;
}
function oneBox(list, type) {
  const matches = list.filter((box) => box.type === type);
  if (matches.length !== 1) throw error();
  return matches[0];
}
function topLevelBoxes(bytes, fileSize) {
  const result = [];
  let offset = 0;
  while (offset < fileSize) {
    if (offset + 8 > bytes.length) {
      if (offset < bytes.length || bytes.length === fileSize) throw error();
      break;
    }
    let size = u32(bytes, offset);
    const type = text(bytes, offset + 4, 4);
    if (size === 1) throw error();
    if (size === 0) size = fileSize - offset;
    const end = offset + size;
    if (size < 8 || !Number.isSafeInteger(end) || end > fileSize) throw error();
    result.push({
      type,
      start: offset + 8,
      end,
      complete: end <= bytes.length,
    });
    if (end > bytes.length) break;
    offset = end;
  }
  return result;
}
function parseAvif(bytes, fileSize) {
  const top = topLevelBoxes(bytes, fileSize);
  const ftyp = oneBox(top, 'ftyp');
  const ftypLength = ftyp.end - ftyp.start;
  if (!ftyp.complete || ftypLength < 8 || (ftypLength - 8) % 4 !== 0)
    throw error();
  let avif = AVIF_BRANDS.has(text(bytes, ftyp.start, 4));
  for (let offset = ftyp.start + 8; offset < ftyp.end; offset += 4)
    avif ||= AVIF_BRANDS.has(text(bytes, offset, 4));
  if (!avif) throw error();

  const meta = oneBox(top, 'meta');
  if (!meta.complete) throw error();
  requireBytes(meta.start, 4, meta.end);
  if (
    bytes[meta.start] !== 0 ||
    bytes[meta.start + 1] !== 0 ||
    bytes[meta.start + 2] !== 0 ||
    bytes[meta.start + 3] !== 0
  )
    throw error();
  const children = boxes(bytes, meta.start + 4, meta.end);

  const pitm = oneBox(children, 'pitm');
  requireBytes(pitm.start, 4, pitm.end);
  const pitmVersion = bytes[pitm.start];
  if (
    (pitmVersion !== 0 && pitmVersion !== 1) ||
    bytes[pitm.start + 1] !== 0 ||
    bytes[pitm.start + 2] !== 0 ||
    bytes[pitm.start + 3] !== 0
  )
    throw error();
  const primaryId =
    pitmVersion === 0
      ? boundedU16(bytes, pitm.start + 4, pitm.end)
      : boundedU32(bytes, pitm.start + 4, pitm.end);
  if (!primaryId || pitm.start + (pitmVersion === 0 ? 6 : 8) !== pitm.end)
    throw error();

  const iprp = oneBox(children, 'iprp');
  const propertyChildren = boxes(bytes, iprp.start, iprp.end);
  const ipco = oneBox(propertyChildren, 'ipco');
  const properties = boxes(bytes, ipco.start, ipco.end);
  const ipma = oneBox(propertyChildren, 'ipma');

  requireBytes(ipma.start, 8, ipma.end);
  const version = bytes[ipma.start];
  const flags =
    (bytes[ipma.start + 1] << 16) |
    (bytes[ipma.start + 2] << 8) |
    bytes[ipma.start + 3];
  if ((version !== 0 && version !== 1) || (flags !== 0 && flags !== 1))
    throw error();
  let offset = ipma.start + 4;
  const count = boundedU32(bytes, offset, ipma.end);
  offset += 4;
  const itemIdLength = version === 0 ? 2 : 4;
  const associationLength = flags === 1 ? 2 : 1;
  if (count > Math.floor((ipma.end - offset) / (itemIdLength + 1)))
    throw error();

  let propertyIndex = 0;
  for (let entry = 0; entry < count; entry += 1) {
    requireBytes(offset, itemIdLength + 1, ipma.end);
    const itemId =
      version === 0
        ? boundedU16(bytes, offset, ipma.end)
        : boundedU32(bytes, offset, ipma.end);
    if (!itemId) throw error();
    offset += itemIdLength;
    const associationCount = bytes[offset];
    offset += 1;
    requireBytes(offset, associationCount * associationLength, ipma.end);
    for (
      let association = 0;
      association < associationCount;
      association += 1
    ) {
      const raw =
        associationLength === 2
          ? boundedU16(bytes, offset, ipma.end)
          : bytes[offset];
      offset += associationLength;
      const index = raw & (associationLength === 2 ? 0x7fff : 0x7f);
      if (index > properties.length) throw error();
      if (
        itemId === primaryId &&
        index &&
        properties[index - 1].type === 'ispe'
      )
        propertyIndex = index;
    }
  }
  if (offset !== ipma.end || !propertyIndex) throw error();

  const ispe = properties[propertyIndex - 1];
  if (
    ispe.end - ispe.start !== 12 ||
    bytes[ispe.start] !== 0 ||
    bytes[ispe.start + 1] !== 0 ||
    bytes[ispe.start + 2] !== 0 ||
    bytes[ispe.start + 3] !== 0
  )
    throw error();
  return dimensions(
    'avif',
    boundedU32(bytes, ispe.start + 4, ispe.end),
    boundedU32(bytes, ispe.start + 8, ispe.end),
  );
}

export async function inspectImageHeader(input) {
  if (
    !input ||
    typeof input.slice !== 'function' ||
    !Number.isFinite(input.size) ||
    input.size <= 0
  )
    throw error();
  const bytes = new Uint8Array(
    await input.slice(0, Math.min(input.size, HEADER_READ_LIMIT)).arrayBuffer(),
  );
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return parseJpeg(bytes);
    if (PNG_SIGNATURE.every((value, index) => bytes[index] === value))
      return parsePng(bytes);
    if (text(bytes, 0, Math.min(4, bytes.length)) === 'RIFF')
      return parseWebp(bytes, input.size);
    if (bytes.length >= 12 && text(bytes, 4, 4) === 'ftyp')
      return parseAvif(bytes, input.size);
  } catch (cause) {
    if (cause instanceof Error && /无法从文件头可靠读取/.test(cause.message))
      throw cause;
    throw error();
  }
  throw error();
}

export async function inspectRemovalInput(input) {
  const inspection = await inspectImageHeader(input);
  if (inspection.width > MAX_DIMENSION || inspection.height > MAX_DIMENSION)
    throw new Error('图片宽度和高度均不能超过 10000 像素');
  if (inspection.width * inspection.height > MAX_PRE_RESIZE_PIXELS)
    throw new Error('图片解码后超过预处理安全上限（3000 万像素）');
  return inspection;
}
