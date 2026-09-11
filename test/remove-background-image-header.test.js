import test from 'node:test';
import assert from 'node:assert/strict';

import {
  inspectImageHeader,
  inspectRemovalInput,
} from '../remove-background/src/image-header.js';
import { decodeValidatedRemovalInput } from '../remove-background/src/input-limits.js';

const be32 = (value) =>
  [value >>> 24, value >>> 16, value >>> 8, value].map((x) => x & 255);
const le24 = (value) => [value, value >>> 8, value >>> 16].map((x) => x & 255);
const ascii = (value) => [...value].map((character) => character.charCodeAt(0));
const file = (bytes, name = 'camera.bin', type = 'application/octet-stream') =>
  new File([Uint8Array.from(bytes)], name, { type });

function jpeg(width, height, orientation = 1) {
  const exif =
    orientation === 1
      ? []
      : [
          0xff,
          0xe1,
          0x00,
          0x22,
          ...ascii('Exif'),
          0,
          0,
          0x49,
          0x49,
          0x2a,
          0,
          8,
          0,
          0,
          0,
          1,
          0,
          0x12,
          0x01,
          3,
          0,
          1,
          0,
          0,
          0,
          orientation,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
        ];
  return [
    0xff,
    0xd8,
    ...exif,
    0xff,
    0xc0,
    0,
    17,
    8,
    height >>> 8,
    height & 255,
    width >>> 8,
    width & 255,
    3,
    1,
    0x11,
    0,
    2,
    0x11,
    0,
    3,
    0x11,
    0,
    0xff,
    0xd9,
  ];
}

function png(width, height, apng = false) {
  return [
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    0,
    0,
    0,
    13,
    ...ascii('IHDR'),
    ...be32(width),
    ...be32(height),
    8,
    6,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...(apng
      ? [0, 0, 0, 8, ...ascii('acTL'), 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]
      : []),
  ];
}

function webpVp8x(width, height) {
  return [
    ...ascii('RIFF'),
    22,
    0,
    0,
    0,
    ...ascii('WEBPVP8X'),
    10,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...le24(width - 1),
    ...le24(height - 1),
  ];
}
function webpVp8l(width, height) {
  const bits = (width - 1) | ((height - 1) << 14);
  return [
    ...ascii('RIFF'),
    18,
    0,
    0,
    0,
    ...ascii('WEBPVP8L'),
    5,
    0,
    0,
    0,
    0x2f,
    bits & 255,
    (bits >>> 8) & 255,
    (bits >>> 16) & 255,
    (bits >>> 24) & 255,
    0,
  ];
}
function webpVp8(width, height) {
  return [
    ...ascii('RIFF'),
    22,
    0,
    0,
    0,
    ...ascii('WEBPVP8 '),
    10,
    0,
    0,
    0,
    0,
    0,
    0,
    0x9d,
    0x01,
    0x2a,
    width & 255,
    width >>> 8,
    height & 255,
    height >>> 8,
  ];
}
const box = (type, payload) => [
  ...be32(payload.length + 8),
  ...ascii(type),
  ...payload,
];
function avif(width, height) {
  const ftyp = box('ftyp', [...ascii('avif'), 0, 0, 0, 0, ...ascii('avif')]);
  const pitm = box('pitm', [0, 0, 0, 0, 0, 1]);
  const ispe = box('ispe', [0, 0, 0, 0, ...be32(width), ...be32(height)]);
  const ipco = box('ipco', ispe);
  const ipma = box('ipma', [0, 0, 0, 0, ...be32(1), 0, 1, 1, 1]);
  const iprp = box('iprp', [...ipco, ...ipma]);
  const meta = box('meta', [0, 0, 0, 0, ...pitm, ...iprp]);
  return [...ftyp, ...meta];
}

test('JPEG dimensions use EXIF display orientation without trusting MIME or extension', async () => {
  assert.deepEqual(
    await inspectImageHeader(
      file(jpeg(4000, 3000, 6), 'renamed.png', 'image/png'),
    ),
    {
      format: 'jpeg',
      encodedWidth: 4000,
      encodedHeight: 3000,
      width: 3000,
      height: 4000,
      orientation: 6,
    },
  );
  assert.deepEqual(await inspectImageHeader(file(jpeg(4000, 3000, 3))), {
    format: 'jpeg',
    encodedWidth: 4000,
    encodedHeight: 3000,
    width: 4000,
    height: 3000,
    orientation: 3,
  });
});

test('PNG and APNG dimensions come from a strict IHDR', async () => {
  assert.deepEqual(await inspectImageHeader(file(png(640, 480))), {
    format: 'png',
    encodedWidth: 640,
    encodedHeight: 480,
    width: 640,
    height: 480,
    orientation: 1,
  });
  assert.equal(
    (await inspectImageHeader(file(png(320, 240, true)))).format,
    'png',
  );
});

test('WebP VP8, VP8L, and VP8X dimension encodings are inspected', async () => {
  for (const [bytes, expected] of [
    [webpVp8(801, 601), [801, 601]],
    [webpVp8l(777, 555), [777, 555]],
    [webpVp8x(1234, 987), [1234, 987]],
  ]) {
    const result = await inspectImageHeader(file(bytes));
    assert.equal(result.format, 'webp');
    assert.deepEqual([result.width, result.height], expected);
  }
});

test('AVIF resolves the primary item ispe dimensions through pitm/ipma/ipco', async () => {
  assert.deepEqual(
    await inspectImageHeader(file(avif(4032, 3024), 'photo.jpg', 'image/jpeg')),
    {
      format: 'avif',
      encodedWidth: 4032,
      encodedHeight: 3024,
      width: 4032,
      height: 3024,
      orientation: 1,
    },
  );
});

test('unknown, truncated, malformed, and unprovable headers fail closed in Chinese', async () => {
  for (const bytes of [
    ascii('not an image'),
    png(0, 12),
    jpeg(10, 10).slice(0, 8),
    [...ascii('RIFF'), 4, 0, 0, 0, ...ascii('WEBP')],
    box('ftyp', [...ascii('avif'), 0, 0, 0, 0, ...ascii('avif')]),
  ])
    await assert.rejects(
      inspectImageHeader(file(bytes)),
      /无法从文件头可靠读取图片格式和尺寸/,
    );
});

test('decompression-bomb header is rejected before decode is called', async () => {
  let decoded = false;
  const bomb = file(png(10000, 10000), 'tiny.png', 'image/png');
  await assert.rejects(
    decodeValidatedRemovalInput(bomb, async () => {
      decoded = true;
      return { width: 1, height: 1 };
    }),
    /3000 万像素/,
  );
  assert.equal(decoded, false);
});

test('inspected JPEG orientation controls the 10000px display edge bound before decode', async () => {
  let decoded = false;
  const candidate = file(jpeg(9999, 10001, 6), 'camera.jpg', 'image/jpeg');
  await assert.rejects(inspectRemovalInput(candidate), /10000 像素/);
  await assert.rejects(
    decodeValidatedRemovalInput(candidate, async () => {
      decoded = true;
      return { width: 1, height: 1 };
    }),
    /10000 像素/,
  );
  assert.equal(decoded, false);
});
