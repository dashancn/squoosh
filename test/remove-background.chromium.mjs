import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../remove-background/node_modules/playwright-core/index.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const build = path.join(root, 'build');
const artifact = path.join(root, 'artifacts', 'remove-background-e2e.png');

const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json'],
  ['.wasm', 'application/wasm'],
  ['.png', 'image/png'],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    if (pathname.endsWith('/')) pathname += 'index.html';
    const target = path.resolve(build, `.${pathname}`);
    assert.ok(target.startsWith(`${build}${path.sep}`));
    const body = await readFile(target);
    response.writeHead(200, { 'content-type': types.get(path.extname(target)) || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end('not found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: '/snap/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ acceptDownloads: true });
const requests = [];
const errors = [];
const navigations = [];
page.on('request', (request) => requests.push(request.url()));
page.on('pageerror', (error) => errors.push(String(error.stack || error)));
page.on('framenavigated', (frame) => frame === page.mainFrame() && navigations.push(frame.url()));

try {
  await page.goto(`${origin}/remove-background/`, { waitUntil: 'networkidle' });
  const initialUrl = page.url();
  const inputBytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f5f1e8';
    context.fillRect(0, 0, 320, 240);
    context.fillStyle = '#1565c0';
    context.beginPath();
    context.arc(160, 120, 72, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#ffca28';
    context.fillRect(135, 70, 50, 100);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.setInputFiles('#file-input', {
    name: 'chromium-generated.png',
    mimeType: 'image/png',
    buffer: Buffer.from(inputBytes),
  });
  assert.equal(page.url(), initialUrl, 'upload must not navigate');
  await page.click('#start-button');
  await page.waitForFunction(() => document.querySelector('#progress').value === 100, null, { timeout: 240_000 });
  assert.equal(page.url(), initialUrl, 'processing must not navigate');
  assert.equal(await page.locator('iframe').count(), 0);

  await page.check('input[name="background"][value="blue"]');
  const exportResult = await page.evaluate(async () => {
    const canvas = document.querySelector('#preview');
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { bytes: Array.from(bytes), mimeType: blob.type };
  });
  const png = Buffer.from(exportResult.bytes);
  await writeFile(artifact, png);

  assert.equal(exportResult.mimeType, 'image/png');
  assert.ok(png.length > 8);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const downloadPromise = page.waitForEvent('download');
  await page.click('#download-button');
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /\.png$/);
  assert.deepEqual(errors, []);
  const external = requests.filter((url) => /^https?:/.test(url) && !url.startsWith(origin));
  assert.deepEqual(external, []);
  assert.ok(requests.some((url) => url.includes('/remove-background/imgly/resources.json')));
  await stat(artifact);

  console.log(JSON.stringify({
    chromium: await browser.version(),
    page: initialUrl,
    finalPage: page.url(),
    mainFrameNavigations: navigations,
    iframeCount: await page.locator('iframe').count(),
    pngBytes: png.length,
    pngSignature: [...png.subarray(0, 8)],
    filename: download.suggestedFilename(),
    progress: await page.locator('#progress').getAttribute('value'),
    requests: requests.length,
    externalRequests: external.length,
    sameOriginResources: requests.filter((url) => url.includes('/remove-background/imgly/')).length,
    pageErrors: errors,
    artifact,
  }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
