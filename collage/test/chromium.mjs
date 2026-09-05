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
  ]);
});

await page.locator('#files').setInputFiles(
  inputFiles.map((file) => ({ ...file, buffer: Buffer.from(file.buffer) })),
);
const results = [];
for (const mode of ['grid', 'vertical', 'horizontal', 'two-columns', 'two-rows', 'three-feature', 'four-grid']) {
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
await page.locator('.thumbnail').first().click();
await page.fill('#focal-y', '50');
await page.locator('#focal-y').dispatchEvent('input');
await page.evaluate(() => { window.__sourceYs = []; });
await page.click('#generate');
await page.waitForFunction(() => document.documentElement.dataset.state === 'complete');
const centerSourceY = await page.evaluate(() => window.__sourceYs[0]);
await page.fill('#focal-y', '10');
await page.locator('#focal-y').dispatchEvent('input');
await page.evaluate(() => { window.__sourceYs = []; });
await page.click('#generate');
await page.waitForFunction(() => document.documentElement.dataset.state === 'complete');
const focal = await page.evaluate(async (centerY) => {
  const response = await fetch(document.querySelector('#download').href);
  const blob = await response.blob();
  return {
    centerPercent: 50,
    topPercent: Number(document.querySelector('#focal-y').value),
    centerSourceY: centerY,
    topSourceY: window.__sourceYs[0],
    type: blob.type,
    size: blob.size,
  };
}, centerSourceY);

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
  focal,
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
