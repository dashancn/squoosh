import { chromium } from '../../remove-background/node_modules/playwright-core/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const repositoryRoot = new URL('../..', import.meta.url).pathname;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const relative = pathname.endsWith('/') ? `${pathname.slice(1)}index.html` : pathname.slice(1);
    const file = normalize(join(repositoryRoot, relative));
    if (!file.startsWith(repositoryRoot)) throw new Error('invalid path');
    response.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch {
    response.statusCode = 404;
    response.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

const browser = await chromium.launch({
  executablePath: '/snap/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));
await page.goto(`http://127.0.0.1:${port}/collage/`, { waitUntil: 'networkidle' });

const inputFiles = await page.evaluate(async () => {
  const makePng = (color, width, height, label) =>
    new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.fillStyle = color;
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#ffffff';
      context.font = 'bold 36px sans-serif';
      context.fillText(label, 20, 50);
      canvas.toBlob(async (blob) => {
        resolve({
          name: `${label.toLowerCase()}.png`,
          mimeType: 'image/png',
          buffer: Array.from(new Uint8Array(await blob.arrayBuffer())),
        });
      }, 'image/png');
    });
  return Promise.all([
    makePng('#d33', 300, 500, 'PERSON'),
    makePng('#3a6', 300, 500, 'TWO'),
    makePng('#36c', 640, 360, 'THREE'),
    makePng('#c63', 420, 300, 'FOUR'),
    makePng('#a3c', 360, 360, 'FIVE'),
    makePng('#099', 360, 360, 'SIX'),
    makePng('#960', 360, 360, 'SEVEN'),
    makePng('#609', 360, 360, 'EIGHT'),
    makePng('#333', 360, 360, 'NINE'),
  ]);
});

await page.locator('#files').setInputFiles(
  inputFiles.slice(0, 3).map((file) => ({ ...file, buffer: Buffer.from(file.buffer) })),
);
await page.waitForFunction(() => document.documentElement.dataset.state === 'complete');
const afterInitial = await page.locator('.thumbnail-item').count();
await page.locator('#add-images').setInputFiles({
  ...inputFiles[3],
  buffer: Buffer.from(inputFiles[3].buffer),
});
await page.waitForFunction(() => document.querySelectorAll('.thumbnail-item').length === 4 && document.documentElement.dataset.state === 'complete');
const afterAdd = await page.locator('.thumbnail-item').count();
const addPickerCleared = await page.locator('#add-images').evaluate((input) => input.files.length);
await page.locator('[data-action="remove-image"]').last().click();
await page.waitForFunction(() => document.querySelectorAll('.thumbnail-item').length === 3 && document.documentElement.dataset.state === 'complete');
const afterRemove = await page.locator('.thumbnail-item').count();
const imageManagement = { afterInitial, afterAdd, afterRemove, addPickerCleared };
await page.locator('#files').setInputFiles(
  inputFiles.map((file) => ({ ...file, buffer: Buffer.from(file.buffer) })),
);
await page.selectOption('#mode', 'nine-grid');
await page.fill('#spacing', '17');
await page.waitForFunction(() => document.querySelectorAll('.preview-cell').length === 9 && document.documentElement.dataset.state === 'complete');
const nineGrid = await page.evaluate(async () => {
  const preview = document.querySelector('#preview');
  const cells = [...document.querySelectorAll('.preview-cell')].map((cell) => {
    const rect = cell.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });
  const blob = await (await fetch(document.querySelector('#download').href)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0);
  const spacing = 17;
  const cellWidth = (bitmap.width - spacing * 2) / 3;
  const cellHeight = (bitmap.height - spacing * 2) / 3;
  const pixels = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      pixels.push(Array.from(context.getImageData(
        Math.floor(column * (cellWidth + spacing) + cellWidth / 2),
        Math.floor(row * (cellHeight + spacing) + cellHeight / 2), 1, 1,
      ).data));
    }
  }
  bitmap.close();
  return { width: preview.naturalWidth, height: preview.naturalHeight, cellCount: cells.length, cells, pixels, size: blob.size, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
});
await writeFile(join(repositoryRoot, 'collage/evidence/chromium-nine-grid.png'), Buffer.from(nineGrid.bytes));
delete nineGrid.bytes;
await page.locator('#files').setInputFiles(
  inputFiles.slice(0, 3).map((file) => ({ ...file, buffer: Buffer.from(file.buffer) })),
);
await page.waitForFunction(() => document.querySelectorAll('.thumbnail-item').length === 3 && document.documentElement.dataset.state === 'complete');
const results = [];
for (const mode of ['grid', 'nine-grid', 'vertical', 'horizontal', 'two-columns', 'two-rows', 'three-feature', 'four-grid', 'left-stack-right-feature', 'top-feature-bottom-pair', 'bottom-feature-top-pair', 'asymmetric-mosaic']) {
  await page.selectOption('#mode', mode);
  await page.fill('#spacing', '17');
  await page.locator('#background').evaluate((input) => {
    input.value = '#102030';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#generate');
  await page.waitForFunction(() => document.documentElement.dataset.state === 'complete');
  const result = await page.evaluate(async (selectedMode) => {
    const preview = document.querySelector('#preview');
    const download = document.querySelector('#download');
    const response = await fetch(download.href);
    const blob = await response.blob();
    return {
      mode: selectedMode,
      type: blob.type,
      size: blob.size,
      width: preview.naturalWidth,
      height: preview.naturalHeight,
      previewVisible: Boolean(preview.src && preview.naturalWidth),
      downloadReady: !download.hidden && download.download === 'collage.png',
      bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
    };
  }, mode);
  const file = `evidence/chromium-${mode}.png`;
  await mkdir(join(repositoryRoot, 'collage/evidence'), { recursive: true });
  await writeFile(join(repositoryRoot, 'collage', file), Buffer.from(result.bytes));
  delete result.bytes;
  results.push({ ...result, file });
}

await page.selectOption('#mode', 'grid');
await page.evaluate(() => {
  window.__sourceYs = [];
  const original = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (...args) {
    if (args.length === 9) window.__sourceYs.push(args[2]);
    return original.apply(this, args);
  };
});
await page.locator('.thumbnail').first().dispatchEvent('click');
await page.fill('#focal-y', '50');
await page.locator('#focal-y').dispatchEvent('input');
await page.evaluate(() => { window.__sourceYs = []; });
await page.waitForFunction(() => document.documentElement.dataset.state === 'complete' && window.__sourceYs.length > 0);
const center = await page.evaluate(async () => {
  const url = document.querySelector('#download').href;
  const bytes = await (await fetch(url)).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return {
    sourceY: window.__sourceYs[0],
    url,
    checksum: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
  };
});
await page.fill('#focal-y', '10');
await page.locator('#focal-y').dispatchEvent('input');
await page.evaluate(() => { window.__sourceYs = []; });
await page.waitForFunction((previousUrl) => document.documentElement.dataset.state === 'complete' && window.__sourceYs.length > 0 && document.querySelector('#download').href !== previousUrl, center.url);
const focal = await page.evaluate(async (centerResult) => {
  const response = await fetch(document.querySelector('#download').href);
  const blob = await response.blob();
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return {
    centerPercent: 50,
    topPercent: Number(document.querySelector('#focal-y').value),
    centerSourceY: centerResult.sourceY,
    topSourceY: window.__sourceYs[0],
    centerUrl: centerResult.url,
    topUrl: document.querySelector('#download').href,
    centerChecksum: centerResult.checksum,
    topChecksum: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    usedSubmit: false,
    type: blob.type,
    size: blob.size,
  };
}, center);

await page.selectOption('#mode', 'three-feature');
await page.click('#generate');
await page.waitForFunction(() => document.documentElement.dataset.state === 'complete');
const threeFeatureBottomRightPixel = await page.evaluate(async () => {
  const blob = await (await fetch(document.querySelector('#download').href)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0);
  const pixel = Array.from(context.getImageData(bitmap.width - 1, bitmap.height - 1, 1, 1).data);
  bitmap.close();
  return pixel;
});

await page.selectOption('#mode', 'grid');
await page.waitForFunction(() => document.documentElement.dataset.state === 'complete');
await page.evaluate(() => {
  window.__drawCrops = [];
  const original = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (...args) {
    if (args.length === 9) window.__drawCrops.push({ sourceX: args[1], sourceY: args[2], sourceWidth: args[3], sourceHeight: args[4] });
    return original.apply(this, args);
  };
});
const checksum = () => page.evaluate(async () => {
  const bytes = await (await fetch(document.querySelector('#download').href)).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
});
const canvasBox = await page.locator('#preview-canvas').boundingBox();
const initialChecksum = await checksum();
await page.evaluate(() => { window.__drawCrops = []; });
await page.locator('#preview-canvas').evaluate((canvas) => {
  const rect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -300, clientX: rect.left + rect.width * 0.25, clientY: rect.top + rect.height * 0.25 }));
});
await page.waitForFunction(() => document.documentElement.dataset.state === 'complete' && window.__drawCrops.length >= 3);
const zoomedChecksum = await checksum();
const zoomedCrop = await page.evaluate(() => window.__drawCrops[0]);
await page.evaluate(() => { window.__drawCrops = []; });
const zoomedUrl = await page.locator('#download').getAttribute('href');
await page.locator('#preview-canvas').evaluate((canvas) => {
  const rect = canvas.getBoundingClientRect();
  const fire = (type, fraction) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, button: 0, clientX: rect.left + rect.width * fraction, clientY: rect.top + rect.height * 0.25 }));
  fire('pointerdown', 0.25);
  fire('pointermove', 0.38);
  fire('pointerup', 0.38);
});
await page.waitForTimeout(500);
const dragDebug = await page.evaluate((oldUrl) => ({ state: document.documentElement.dataset.state, changed: document.querySelector('#download').href !== oldUrl, crops: window.__drawCrops.length, focalX: document.querySelector('#focal-x').value }), zoomedUrl);
if (!dragDebug.changed || dragDebug.crops < 3) throw new Error(`preview drag did not regenerate: ${JSON.stringify(dragDebug)}`);
const draggedChecksum = await checksum();
const draggedCrop = await page.evaluate(() => window.__drawCrops[0]);
await page.evaluate(() => { window.__drawCrops = []; });
await page.evaluate(() => {
  const handle = document.querySelector('.reorder-handle');
  const target = document.querySelectorAll('.preview-cell')[2].getBoundingClientRect();
  const source = handle.getBoundingClientRect();
  const fire = (type, x, y) => handle.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 9, button: 0, clientX: x, clientY: y }));
  fire('pointerdown', source.left + source.width / 2, source.top + source.height / 2);
  fire('pointerup', target.left + target.width / 2, target.top + target.height / 2);
});
await page.waitForFunction(() => document.documentElement.dataset.state === 'complete' && window.__drawCrops.length >= 3);
const canvasInteraction = await page.evaluate(({ initialChecksum, zoomedChecksum, draggedChecksum, zoomedCrop, draggedCrop }) => ({
  initialChecksum, zoomedChecksum, draggedChecksum,
  initialSourceWidth: 300,
  zoomedSourceWidth: zoomedCrop.sourceWidth,
  zoomedSourceX: zoomedCrop.sourceX,
  draggedSourceX: draggedCrop.sourceX,
  orderAfterReorder: [...document.querySelectorAll('.thumbnail')].map((button) => button.getAttribute('aria-label').split('：').at(-1)),
  reorderedSourceWidth: window.__drawCrops[2].sourceWidth,
  selectedAfterReorder: [...document.querySelectorAll('.thumbnail')].findIndex((button) => button.classList.contains('selected')),
}), { initialChecksum, zoomedChecksum, draggedChecksum, zoomedCrop, draggedCrop });

await page.setViewportSize({ width: 375, height: 812 });
const mobile = await page.evaluate(() => {
  const editor = document.querySelector('#position-editor');
  const slider = document.querySelector('#focal-y').getBoundingClientRect();
  return {
    viewportWidth: document.documentElement.clientWidth,
    editorVisible: !editor.hidden && editor.getBoundingClientRect().height > 0,
    sliderWidth: slider.width,
    sliderRight: slider.right,
  };
});

const evidence = {
  chromiumVersion: await browser.version(),
  path: new URL(page.url()).pathname,
  inputCount: await page.locator('#files').evaluate((input) => input.files.length),
  iframeCount: await page.locator('iframe').count(),
  results,
  imageManagement,
  nineGrid,
  focal,
  threeFeatureBottomRightPixel,
  canvasInteraction,
  mobile,
  pageErrors,
};
const evidenceDir = join(repositoryRoot, 'collage/evidence');
await mkdir(evidenceDir, { recursive: true });
await writeFile(join(evidenceDir, 'chromium.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));

await browser.close();
await new Promise((resolve) => server.close(resolve));
if (
  pageErrors.length ||
  evidence.iframeCount !== 0 ||
  results.some((result) => result.type !== 'image/png' || !result.size || !result.previewVisible || !result.downloadReady)
) {
  process.exitCode = 1;
}
