import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function jpeg(width, height, orientation = 1, afterExif = []) {
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
    ...afterExif,
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

function png(width, height, apng = false, bitDepth = 8, colorType = 6) {
  const ihdr = [
    ...ascii('IHDR'),
    ...be32(width),
    ...be32(height),
    bitDepth,
    colorType,
    0,
    0,
    0,
  ];
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
    ...ihdr,
    ...be32(crc32(ihdr)),
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

function avifWithIpma(ipmaPayload, afterIpma = []) {
  const ftyp = box('ftyp', [...ascii('avif'), 0, 0, 0, 0, ...ascii('avif')]);
  const pitm = box('pitm', [0, 0, 0, 0, 0, 1]);
  const ispe = box('ispe', [0, 0, 0, 0, ...be32(40), ...be32(30)]);
  const ipco = box('ipco', ispe);
  const iprp = box('iprp', [
    ...ipco,
    ...box('ipma', ipmaPayload),
    ...afterIpma,
  ]);
  return [...ftyp, ...box('meta', [0, 0, 0, 0, ...pitm, ...iprp])];
}

const le32 = (value) =>
  [value, value >>> 8, value >>> 16, value >>> 24].map((x) => x & 255);
const app1 = (payload) => [
  0xff,
  0xe1,
  (payload.length + 2) >>> 8,
  (payload.length + 2) & 255,
  ...payload,
];

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

test('JPEG preserves the first valid EXIF orientation across later non-EXIF APP1 metadata', async () => {
  const xmp = app1(ascii('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>'));
  assert.deepEqual(await inspectImageHeader(file(jpeg(4000, 3000, 6, xmp))), {
    format: 'jpeg',
    encodedWidth: 4000,
    encodedHeight: 3000,
    width: 3000,
    height: 4000,
    orientation: 6,
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

test('PNG accepts every legal bit-depth/color-type pair and rejects every illegal pair', async () => {
  const legal = new Set([
    '1/0',
    '2/0',
    '4/0',
    '8/0',
    '16/0',
    '8/2',
    '16/2',
    '1/3',
    '2/3',
    '4/3',
    '8/3',
    '8/4',
    '16/4',
    '8/6',
    '16/6',
  ]);
  for (const bitDepth of [1, 2, 4, 8, 16]) {
    for (const colorType of [0, 2, 3, 4, 6]) {
      const candidate = inspectImageHeader(
        file(png(32, 24, false, bitDepth, colorType)),
      );
      if (legal.has(`${bitDepth}/${colorType}`)) {
        assert.equal(
          (await candidate).format,
          'png',
          `${bitDepth}/${colorType}`,
        );
      } else {
        await assert.rejects(
          candidate,
          /无法从文件头可靠读取/,
          `${bitDepth}/${colorType}`,
        );
      }
    }
  }
});

test('PNG rejects a missing, truncated, or bad IHDR CRC before decode', async () => {
  const valid = png(640, 480);
  const badCrc = [...valid];
  badCrc[32] ^= 1;
  for (const bytes of [valid.slice(0, 29), valid.slice(0, 32), badCrc]) {
    let decoded = false;
    await assert.rejects(
      decodeValidatedRemovalInput(
        file(bytes, 'invalid.png', 'image/png'),
        async () => {
          decoded = true;
          return { width: 640, height: 480 };
        },
      ),
      /无法从文件头可靠读取/,
    );
    assert.equal(decoded, false);
  }
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

test('WebP dimensions are accepted when the valid RIFF fixture exceeds the bounded header slice', async () => {
  const bytes = await readFile(
    new URL('fixtures/large-valid.webp', import.meta.url),
  );
  const result = await inspectImageHeader(
    new File([bytes], 'large-valid.webp'),
  );
  assert.ok(bytes.length > 1024 * 1024);
  assert.deepEqual(
    [result.format, result.width, result.height],
    ['webp', 1024, 1024],
  );
});

test('WebP validates inspected chunk arithmetic and bounded skips', async () => {
  const tooLarge = webpVp8x(640, 480);
  tooLarge.splice(16, 4, ...le32(12));
  await assert.rejects(
    inspectImageHeader(file(tooLarge)),
    /无法从文件头可靠读取/,
  );

  const vp8lChunk = webpVp8l(77, 55).slice(12);
  const oddUnknownChunk = [
    ...ascii('RIFF'),
    ...le32(4 + 10 + vp8lChunk.length),
    ...ascii('WEBP'),
    ...ascii('JUNK'),
    ...le32(1),
    0,
    0,
    ...vp8lChunk,
  ];
  const result = await inspectImageHeader(file(oddUnknownChunk));
  assert.deepEqual([result.width, result.height], [77, 55]);

  const truncatedUnknownChunk = [
    ...ascii('RIFF'),
    ...le32(4 + 8 + 1024 * 1024),
    ...ascii('WEBP'),
    ...ascii('JUNK'),
    ...le32(1024 * 1024),
    0,
  ];
  await assert.rejects(
    inspectImageHeader(
      new File(
        [
          Uint8Array.from(truncatedUnknownChunk),
          new Uint8Array(1024 * 1024 - 1),
        ],
        'unprovable.webp',
      ),
    ),
    /无法从文件头可靠读取/,
  );
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

test('AVIF ipma cannot consume entry bytes fabricated by a sibling box', async () => {
  const truncatedIpma = [0, 0, 0, 0, ...be32(2), 0, 1, 1, 1];
  const sibling = box('free', [1]);
  let decoded = false;
  await assert.rejects(
    decodeValidatedRemovalInput(
      file(avifWithIpma(truncatedIpma, sibling)),
      async () => {
        decoded = true;
        return { width: 40, height: 30 };
      },
    ),
    /无法从文件头可靠读取/,
  );
  assert.equal(decoded, false);
});

test('AVIF rejects truncated and malformed ipma fields before decode', async () => {
  const valid = [0, 0, 0, 0, ...be32(1), 0, 1, 1, 1];
  const malformed = [
    valid.slice(0, 3),
    [2, 0, 0, 0, ...be32(1), 0, 1, 1, 1],
    [0, 0, 0, 2, ...be32(1), 0, 1, 1, 1],
    [0, 0, 0, 0, ...be32(2), 0, 1, 1, 1],
    [0, 0, 0, 0, ...be32(1), 0, 0, 1, 1],
    [0, 0, 0, 0, ...be32(1), 0, 1, 2, 1],
    [...valid, 0],
  ];
  for (const payload of malformed) {
    let decoded = false;
    await assert.rejects(
      decodeValidatedRemovalInput(file(avifWithIpma(payload)), async () => {
        decoded = true;
        return { width: 40, height: 30 };
      }),
      /无法从文件头可靠读取/,
    );
    assert.equal(decoded, false);
  }
});

test('AVIF metadata remains inspectable before a large mdat fixture crosses the bounded header slice', async () => {
  const bytes = await readFile(
    new URL('fixtures/large-valid.avif', import.meta.url),
  );
  const result = await inspectImageHeader(
    new File([bytes], 'large-valid.avif'),
  );
  assert.ok(bytes.length > 1024 * 1024);
  assert.deepEqual(
    [result.format, result.width, result.height],
    ['avif', 1, 1],
  );
});

test('unknown, truncated, malformed, and unprovable headers fail closed in Chinese', async () => {
  for (const bytes of [
    ascii('not an image'),
    png(0, 12),
    jpeg(10, 10).slice(0, 8),
    [...ascii('RIFF'), 4, 0, 0, 0, ...ascii('WEBP')],
    box('ftyp', [...ascii('avif'), 0, 0, 0, 0, ...ascii('avif')]),
    [...avif(40, 30), 0, 0, 0, 8],
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
