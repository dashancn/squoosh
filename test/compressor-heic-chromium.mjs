import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../remove-background/node_modules/playwright-core/index.mjs';
import { findChromiumExecutable } from '../heic-converter/corresponding-source/rebuild/chromium-executable.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const build = path.join(root, 'build');
const types = new Map([
  ['.html', 'text/html'],
  ['.js', 'text/javascript'],
  ['.mjs', 'text/javascript'],
  ['.css', 'text/css'],
  ['.wasm', 'application/wasm'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
]);
const headerText = await readFile(path.join(build, '_headers'), 'utf8');
const rootHeaders = headerText.split('\n/heic-converter/*')[0];
const csp = rootHeaders.match(/Content-Security-Policy:\s*([^\n]+)/)?.[1];
const coop = rootHeaders.match(/Cross-Origin-Opener-Policy:\s*([^\n]+)/)?.[1];
const coep = rootHeaders.match(/Cross-Origin-Embedder-Policy:\s*([^\n]+)/)?.[1];
const corp = rootHeaders.match(/Cross-Origin-Resource-Policy:\s*([^\n]+)/)?.[1];
assert.ok(csp, 'generated compressor CSP header missing');
assert.equal(coop, 'same-origin');
assert.equal(coep, 'require-corp');
assert.equal(corp, 'same-origin');
const server = createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(
      new URL(request.url, 'http://x').pathname,
    );
    if (pathname === '/editor') pathname = '/index.html';
    if (pathname.endsWith('/')) pathname += 'index.html';
    const target = path.resolve(build, `.${pathname}`);
    if (target !== build && !target.startsWith(`${build}${path.sep}`))
      throw new Error();
    const body = await readFile(target);
    response.writeHead(200, {
      'content-type':
        types.get(path.extname(target)) || 'application/octet-stream',
      'content-security-policy': csp,
      'cross-origin-opener-policy': coop,
      'cross-origin-embedder-policy': coep,
      'cross-origin-resource-policy': corp,
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: findChromiumExecutable(),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const heicBuffer = await readFile(
  new URL(
    '../heic-converter/tests/fixtures/libheif-example.heic',
    import.meta.url,
  ),
);
const heicFile = {
  name: 'portrait.heic',
  mimeType: 'image/heic',
  buffer: heicBuffer,
};
const errors = [];
const cspViolations = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await page.route('https://stats.i41.cn/analytics.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      headers: { 'cross-origin-resource-policy': 'cross-origin' },
      body: '',
    }),
  );
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.exposeFunction('recordCspViolation', (event) =>
    cspViolations.push(event),
  );
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) =>
      window.recordCspViolation({
        blockedURI: event.blockedURI,
        violatedDirective: event.violatedDirective,
      }),
    );
    const NativeFile = File;
    window.File = class extends NativeFile {
      constructor(parts, name, options) {
        super(parts, name, options);
        if (options?.type === 'image/png' && name.endsWith('.png')) {
          window.heicDecodedCapture = createImageBitmap(this).then((bitmap) => {
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = canvas.getContext('2d');
            context.drawImage(bitmap, 0, 0);
            const pixel = [
              ...context.getImageData(
                Math.floor(bitmap.width / 2),
                Math.floor(bitmap.height / 2),
                1,
                1,
              ).data,
            ];
            bitmap.close();
            return {
              name,
              type: this.type,
              width: canvas.width,
              height: canvas.height,
              pixel,
            };
          });
        }
      }
    };
  });
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(origin + '/');
  const baselineEnd = requests.length;
  const jpg = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 31;
    c.height = 19;
    const x = c.getContext('2d');
    x.fillStyle = '#e31b23';
    x.fillRect(0, 0, 31, 19);
    const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
    return [...new Uint8Array(await b.arrayBuffer())];
  });
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'baseline.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(jpg),
    });
  await page.waitForURL('**/editor', { timeout: 60_000 }).catch((error) => {
    error.message += `; errors=${JSON.stringify(errors)}; csp=${JSON.stringify(cspViolations)}`;
    throw error;
  });
  await page.waitForSelector('canvas');
  assert.equal(
    requests.some(
      (url, i) => i >= baselineEnd && /heic-worker|heic-to-1\.5\.2/.test(url),
    ),
    false,
    'ordinary JPG requested HEIC assets',
  );

  await page.goto(origin + '/');
  const heicStart = requests.length;
  await page.locator('input[type=file]').setInputFiles(heicFile);
  await page
    .locator('aside[role=status]')
    .filter({ hasText: 'HEIC' })
    .waitFor();
  await page.waitForURL('**/editor', { timeout: 300000 });
  await page.waitForSelector('canvas', { timeout: 300000 });
  await page
    .locator('body')
    .filter({ hasText: 'portrait.png' })
    .waitFor({ timeout: 300000 });
  const heicRequests = requests
    .slice(heicStart)
    .filter((url) => /heic-worker|heic-to-1\.5\.2/.test(url));
  assert.ok(
    heicRequests.some((url) =>
      url.endsWith('/heic-converter/src/heic-worker.mjs'),
    ),
  );
  assert.ok(
    heicRequests.some((url) => url.includes('heic-to-1.5.2.worker.js')),
  );
  const editorState = await page.evaluate(() => ({
    title: document.title,
    text: document.body.textContent,
  }));
  assert.match(editorState.title, /portrait\.png/);
  assert.match(editorState.text, /portrait\.png/);
  const capture = await page.evaluate(() => window.heicDecodedCapture);
  assert.deepEqual([capture.width, capture.height], [1280, 854]);
  assert.equal(capture.type, 'image/png');
  assert.equal(capture.pixel[3], 255);
  assert.match(
    await page.locator('aside[role=status]').textContent(),
    /LGPL-3\.0/,
  );
  const exportLink = page
    .locator(
      'a[download$=".jpg"][href^="blob:"], a[download$=".jpeg"][href^="blob:"], a[download$=".webp"][href^="blob:"]',
    )
    .first();
  await exportLink.waitFor({ timeout: 300000 });
  const compressedExport = await exportLink.evaluate(async (link) => {
    const response = await fetch(link.href);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const pixel = [
      ...context.getImageData(
        Math.floor(bitmap.width / 2),
        Math.floor(bitmap.height / 2),
        1,
        1,
      ).data,
    ];
    bitmap.close();
    return {
      name: link.getAttribute('download'),
      mimeType: blob.type,
      byteLength: blob.size,
      width: canvas.width,
      height: canvas.height,
      pixel,
    };
  });
  assert.ok(
    compressedExport.byteLength > 0,
    'HEIC compressor did not produce a downloadable encoded output',
  );
  assert.match(compressedExport.mimeType, /^image\/(?:jpeg|webp)$/);
  assert.deepEqual(
    [compressedExport.width, compressedExport.height],
    [1280, 854],
  );
  assert.equal(compressedExport.pixel[3], 255);
  assert.ok(
    compressedExport.pixel.slice(0, 3).some((channel) => channel !== 0),
    'encoded output center pixel is unexpectedly black',
  );
  const downloadPromise = page.waitForEvent('download');
  await exportLink.click({ force: true });
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), compressedExport.name);
  assert.equal(await download.failure(), null);

  await page.goto(origin + '/');
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'fake.heic',
      mimeType: 'image/heic',
      buffer: Buffer.from('not a HEIC'),
    });
  await page.waitForTimeout(1000);
  assert.equal(new URL(page.url()).pathname, '/');
  assert.equal(await page.locator('aside[role=status]').count(), 1);

  await page.goto(origin + '/');
  await page.locator('input[type=file]').setInputFiles(heicFile);
  await page.locator('aside[role=status]').waitFor();
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'winner.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(jpg),
    });
  await page.waitForURL('**/editor');
  assert.equal(
    await page
      .locator('body')
      .textContent()
      .then((x) => x.includes('portrait.png')),
    false,
  );

  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(origin + '/');
  await page.locator('input[type=file]').setInputFiles(heicFile);
  await page.locator('aside[role=status]').waitFor();
  const layout = await page
    .locator('aside[role=status]')
    .evaluate((el) => ({
      left: el.getBoundingClientRect().left,
      right: el.getBoundingClientRect().right,
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
  assert.equal(layout.scroll, layout.client);
  assert.ok(layout.left >= 0 && layout.right <= layout.client);
  assert.deepEqual(cspViolations, []);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        jpg: { heicRequests: 0 },
        heic: {
          assetRequests: heicRequests,
          decodedDimensions: [1280, 854],
          compressedExport,
        },
        invalidFakeStayedHome: true,
        raceWinner: 'winner.jpg',
        mobile: layout,
        cspViolations,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
