import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../remove-background/node_modules/playwright-core/index.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const build = path.join(root, 'build');
const artifact = path.join(root, 'artifacts', 'remove-background-e2e.png');

const headerText = await readFile(path.join(build, '_headers'), 'utf8');
const routeCsp = headerText.match(/Content-Security-Policy:\s*([^\n]+)/)?.[1];
assert.ok(routeCsp, 'generated production CSP missing');
assert.match(routeCsp, /script-src 'self' blob: 'wasm-unsafe-eval' 'unsafe-eval'/);

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
    const headers = { 'content-type': types.get(path.extname(target)) || 'application/octet-stream' };
    if (url.pathname.startsWith('/remove-background/')) {
      headers['content-security-policy'] = routeCsp;
    }
    response.writeHead(200, headers);
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
await page.addInitScript(() => {
  const createBitmap = globalThis.createImageBitmap.bind(globalThis);
  globalThis.createImageBitmap = async (...args) => {
    const bitmap = await createBitmap(...args);
    if (globalThis.__delayNextPreviewBitmap) {
      globalThis.__delayNextPreviewBitmap = false;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return bitmap;
  };
  const canvasToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (...args) {
    if (globalThis.__failNextCanvasExport) {
      globalThis.__failNextCanvasExport = false;
      queueMicrotask(() => args[0](null));
      return;
    }
    return canvasToBlob.apply(this, args);
  };
});
const requests = [];
const errors = [];
const consoleErrors = [];
const navigations = [];
page.on('request', (request) => requests.push(request.url()));
page.on('pageerror', (error) => errors.push(String(error.stack || error)));
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
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
  const replacementBytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const context = canvas.getContext('2d');
    context.fillStyle = '#e53935';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.evaluate(() => {
    globalThis.__delayNextPreviewBitmap = true;
  });
  await page.setInputFiles('#file-input', {
    name: 'chromium-generated.png',
    mimeType: 'image/png',
    buffer: Buffer.from(inputBytes),
  });
  await page.setInputFiles('#file-input', {
    name: 'replacement.png',
    mimeType: 'image/png',
    buffer: Buffer.from(replacementBytes),
  });
  assert.equal(page.url(), initialUrl, 'upload must not navigate');
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#preview');
    return canvas.width > 0 && canvas.height > 0 && document.querySelector('#preview-empty').hidden;
  });
  const selectionPreview = await page.locator('#preview').evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height,
    alpha: canvas.getContext('2d').getImageData(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1,
    ).data[3],
  }));
  assert.deepEqual(selectionPreview, { width: 64, height: 48, alpha: 255 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(
    await page.locator('#preview').evaluate((canvas) => ({
      width: canvas.width,
      height: canvas.height,
      red: canvas.getContext('2d').getImageData(1, 1, 1, 1).data[0],
    })),
    { width: 64, height: 48, red: 229 },
    'stale preview must not overwrite the replacement',
  );
  await page.setInputFiles('#file-input', {
    name: 'chromium-generated.png',
    mimeType: 'image/png',
    buffer: Buffer.from(inputBytes),
  });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#preview');
    return canvas.width === 320 && canvas.height === 240;
  });
  assert.equal(await page.locator('#download-button').isDisabled(), true);
  assert.equal(
    await page.locator('#mask-editor-controls').evaluate((fieldset) => fieldset.disabled),
    true,
  );
  assert.equal(
    await page.locator('#crop-controls').evaluate((fieldset) => fieldset.disabled),
    true,
  );
  await page.click('#start-button');
  try {
    await page.locator('#status').filter({ hasText: '抠图完成' }).waitFor({ timeout: 240_000 });
  } catch (error) {
    throw new Error(`remove-background did not complete: ${await page.locator('#status').textContent()} | page errors: ${errors.join(' | ')} | console errors: ${consoleErrors.join(' | ')}`, { cause: error });
  }
  assert.equal(page.url(), initialUrl, 'processing must not navigate');
  assert.equal(await page.locator('iframe').count(), 0);
  assert.equal(
    await page.locator('#start-button').isEnabled(),
    true,
    'Start must be enabled after a completed inference',
  );
  await page.click('#start-button');
  try {
    await page.locator('#status').filter({ hasText: '抠图完成' }).waitFor({ timeout: 240_000 });
  } catch (error) {
    throw new Error(
      `second remove-background run did not complete: ${await page.locator('#status').textContent()} | page errors: ${errors.join(' | ')} | console errors: ${consoleErrors.join(' | ')}`,
      { cause: error },
    );
  }
  await page.evaluate(() => {
    globalThis.__failNextCanvasExport = true;
  });
  await page.click('#start-button');
  try {
    await page.locator('#status').filter({ hasText: '抠图失败：PNG 导出失败' }).waitFor({ timeout: 240_000 });
  } catch (error) {
    throw new Error(
      `post-extraction export failure was not observed: ${await page.locator('#status').textContent()} | page errors: ${errors.join(' | ')} | console errors: ${consoleErrors.join(' | ')}`,
      { cause: error },
    );
  }
  assert.equal(
    await page.locator('#start-button').isEnabled(),
    true,
    'Start must recover after a post-extraction export failure',
  );
  await page.click('#start-button');
  try {
    await page.locator('#status').filter({ hasText: '抠图完成' }).waitFor({ timeout: 240_000 });
  } catch (error) {
    throw new Error(
      `retry after post-extraction export failure did not complete: ${await page.locator('#status').textContent()} | page errors: ${errors.join(' | ')} | console errors: ${consoleErrors.join(' | ')}`,
      { cause: error },
    );
  }

  await page.locator('#preview').scrollIntoViewIfNeeded();
  const editorBaseline = await page.locator('#preview').evaluate((canvas) => {
    const x = Math.floor(canvas.width / 2);
    const y = Math.floor(canvas.height / 2);
    return [...canvas.getContext('2d').getImageData(x, y, 1, 1).data];
  });
  const box = await page.locator('#preview').boundingBox();
  const canvasSize = await page.locator('#preview').evaluate((canvas) => ({ width: canvas.width, height: canvas.height }));
  const scale = Math.min(box.width / canvasSize.width, box.height / canvasSize.height);
  const drawnWidth = canvasSize.width * scale;
  const drawnHeight = canvasSize.height * scale;
  const drawLeft = box.x + (box.width - drawnWidth) / 2;
  const drawTop = box.y + (box.height - drawnHeight) / 2;
  const centerX = drawLeft + drawnWidth / 2;
  const centerY = drawTop + drawnHeight / 2;
  await page.mouse.move(centerX, centerY);
  await page.waitForFunction(() => !document.querySelector('#brush-indicator').hidden);
  const indicator = await page.locator('#brush-indicator').evaluate((element) => ({
    width: parseFloat(element.style.width),
    height: parseFloat(element.style.height),
  }));
  assert.ok(indicator.width > 0);
  assert.equal(indicator.width, indicator.height);

  await page.click('#zoom-in-button');
  assert.equal(await page.locator('#zoom-output').textContent(), '125%');
  const zoomedTransform = await page.locator('#preview').evaluate((canvas) => canvas.style.transform);
  assert.match(zoomedTransform, /scale\(1\.25\)/);
  await page.click('#pan-mode-button');
  assert.equal(await page.locator('#pan-mode-button').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#preview').getAttribute('class'), 'panning');
  const panBox = await page.locator('.preview-panel').boundingBox();
  assert.ok(panBox, 'preview panel must be visible for panning');
  const panX = panBox.x + panBox.width / 2;
  const panY = panBox.y + Math.min(panBox.height - 24, 260);
  await page.locator('#preview').evaluate(
    (canvas, { x, y }) => {
      for (const [type, clientX, clientY, buttons] of [
        ['pointerdown', x, y, 1],
        ['pointermove', x + 5000, y + 5000, 1],
        ['pointerup', x + 5000, y + 5000, 0],
      ])
        {
          const event = new PointerEvent(type, {
            bubbles: true,
            pointerId: 21,
            button: 0,
            buttons,
            clientX,
            clientY,
          });
          Object.defineProperty(event, 'isPrimary', { value: true });
          canvas.dispatchEvent(event);
        }
    },
    { x: panX, y: panY },
  );
  const pannedTransform = await page.locator('#preview').evaluate((canvas) => canvas.style.transform);
  assert.notEqual(pannedTransform, zoomedTransform);
  const panLimit = await page.locator('#preview').evaluate((canvas) => {
    const match = canvas.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    const panel = canvas.parentElement.getBoundingClientRect();
    const scale = Math.min(panel.width / canvas.width, panel.height / canvas.height);
    return {
      x: Number(match?.[1]),
      y: Number(match?.[2]),
      maxX: (canvas.width * scale * 0.25) / (2 * 1.25),
      maxY: (canvas.height * scale * 0.25) / (2 * 1.25),
      intrinsicWidth: canvas.width,
      renderedWidth: canvas.width * scale,
    };
  });
  assert.notEqual(panLimit.intrinsicWidth, panLimit.renderedWidth, 'E2E must exercise intrinsic/CSS mismatch');
  assert.ok(Math.abs(panLimit.x - panLimit.maxX) < 0.01, `horizontal pan not CSS-clamped: ${JSON.stringify(panLimit)}`);
  assert.ok(Math.abs(panLimit.y - panLimit.maxY) < 0.01, `vertical pan not CSS-clamped: ${JSON.stringify(panLimit)}`);
  await page.click('#zoom-reset-button');
  assert.equal(await page.locator('#zoom-output').textContent(), '100%');
  await page.locator('#preview').scrollIntoViewIfNeeded();
  const resetBox = await page.locator('#preview').boundingBox();
  const resetCenterX = resetBox.x + resetBox.width / 2;
  const resetCenterY = resetBox.y + resetBox.height / 2;
  assert.equal(await page.locator('#preview').getAttribute('class'), '');
  assert.equal(
    await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, { x: resetCenterX, y: resetCenterY }),
    'preview',
  );

  await page.mouse.move(resetCenterX, resetCenterY);
  await page.mouse.down();
  await page.mouse.move(resetCenterX + 24, resetCenterY, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction((baseline) => {
    const canvas = document.querySelector('#preview');
    return canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[3] < baseline;
  }, editorBaseline[3]);
  const erased = await page.locator('#preview').evaluate((canvas) => [...canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data]);
  assert.ok(erased[3] < editorBaseline[3], `erase did not reduce alpha: ${editorBaseline[3]} -> ${erased[3]}`);
  await page.click('#undo-button');
  const undone = await page.locator('#preview').evaluate((canvas) => [...canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data]);
  assert.equal(undone[3], editorBaseline[3]);
  await page.click('#redo-button');
  const redone = await page.locator('#preview').evaluate((canvas) => [...canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data]);
  assert.equal(redone[3], erased[3]);
  await page.click('#restore-mode');
  await page.locator('#preview').scrollIntoViewIfNeeded();
  const restoreBox = await page.locator('#preview').boundingBox();
  await page.mouse.click(
    restoreBox.x + restoreBox.width / 2,
    restoreBox.y + restoreBox.height / 2,
  );
  const restored = await page.locator('#preview').evaluate((canvas) => [...canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data]);
  assert.ok(restored[3] > erased[3]);
  await page.click('#reset-mask-button');
  const reset = await page.locator('#preview').evaluate((canvas) => [...canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data]);
  assert.equal(reset[3], editorBaseline[3]);

  await page.locator('#preview').scrollIntoViewIfNeeded();
  const preCropBox = await page.locator('#preview').boundingBox();
  await page.mouse.move(preCropBox.x + preCropBox.width / 2, preCropBox.y + preCropBox.height / 2);
  await page.waitForFunction(() => !document.querySelector('#brush-indicator').hidden);
  await page.click('#crop-mode-button');
  assert.equal(await page.locator('#crop-mode-button').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#brush-indicator').getAttribute('hidden'), '');
  await page.mouse.move(preCropBox.x + preCropBox.width / 2 + 1, preCropBox.y + preCropBox.height / 2 + 1);
  assert.equal(await page.locator('#brush-indicator').getAttribute('hidden'), '', 'crop pointermove must not reveal brush indicator');
  await page.click('#zoom-in-button');
  await page.click('#pan-mode-button');
  assert.equal(await page.locator('#pan-mode-button').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#crop-mode-button').getAttribute('aria-pressed'), 'false');
  await page.click('#crop-mode-button');
  assert.equal(await page.locator('#crop-mode-button').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#pan-mode-button').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#brush-indicator').getAttribute('hidden'), '');
  await page.click('#zoom-reset-button');
  await page.locator('#preview').scrollIntoViewIfNeeded();
  const zeroDragBox = await page.locator('#preview').boundingBox();
  await page.selectOption('#crop-aspect', '16:9');
  await page.locator('#preview').evaluate(
    (canvas, { x, y }) => {
      for (const [type, buttons] of [['pointerdown', 1], ['pointerup', 0]]) {
        const event = new PointerEvent(type, {
          bubbles: true,
          pointerId: 24,
          button: 0,
          buttons,
          clientX: x,
          clientY: y,
        });
        Object.defineProperty(event, 'isPrimary', { value: true });
        canvas.dispatchEvent(event);
      }
    },
    { x: zeroDragBox.x + zeroDragBox.width / 2, y: zeroDragBox.y + zeroDragBox.height / 2 },
  );
  assert.match(await page.locator('#crop-output').textContent(), /16 × 9 px/, 'preset must apply from pointerdown without a drag');
  await page.click('#reset-crop-button');
  await page.click('#crop-mode-button');
  await page.selectOption('#crop-aspect', 'free');
  const cropBox = await page.locator('#preview').boundingBox();
  const cropDrawScale = Math.min(cropBox.width / 320, cropBox.height / 240);
  const cropDrawWidth = 320 * cropDrawScale;
  const cropDrawHeight = 240 * cropDrawScale;
  const cropDrawLeft = cropBox.x + (cropBox.width - cropDrawWidth) / 2;
  const cropDrawTop = cropBox.y + (cropBox.height - cropDrawHeight) / 2;
  const cropStartX = cropDrawLeft + cropDrawWidth * 0.25;
  const cropStartY = cropDrawTop + cropDrawHeight * 0.25;
  const cropEndX = cropDrawLeft + cropDrawWidth * 0.75;
  const cropEndY = cropDrawTop + cropDrawHeight * 0.75 - 1;
  await page.locator('#preview').evaluate(
    (canvas, { startX, startY, endX, endY }) => {
      for (const [type, clientX, clientY, buttons] of [
        ['pointerdown', startX, startY, 1],
        ['pointermove', endX, endY, 1],
        ['pointerup', endX, endY, 0],
      ]) {
        const event = new PointerEvent(type, {
          bubbles: true,
          pointerId: 23,
          button: 0,
          buttons,
          clientX,
          clientY,
        });
        Object.defineProperty(event, 'isPrimary', { value: true });
        canvas.dispatchEvent(event);
      }
    },
    { startX: cropStartX, startY: cropStartY, endX: cropEndX, endY: cropEndY },
  );
  assert.equal(await page.locator('#crop-selection').getAttribute('hidden'), null);
  assert.equal(await page.locator('#crop-selection [data-crop-handle]').count(), 8);
  assert.match(await page.locator('#crop-output').textContent(), /160 × 120 px/);
  assert.equal(await page.locator('#preview').evaluate((canvas) => `${canvas.width}x${canvas.height}`), '320x240', 'draft crop must be non-destructive');
  const southeast = await page.locator('[data-crop-handle="se"]').boundingBox();
  assert.ok(southeast, 'southeast crop handle must be visible');
  await page.mouse.move(southeast.x + southeast.width / 2, southeast.y + southeast.height / 2);
  await page.mouse.down();
  await page.mouse.move(southeast.x + southeast.width / 2 + 20, southeast.y + southeast.height / 2 + 15, { steps: 4 });
  await page.mouse.up();
  assert.doesNotMatch(await page.locator('#crop-output').textContent(), /^160 × 120 px/);
  const resizedDraft = await page.locator('#crop-output').textContent();
  const match = resizedDraft.match(/^(\d+) × (\d+) px/);
  assert.ok(match, resizedDraft);
  const expectedCropSize = `${match[1]}x${match[2]}`;
  await page.click('#apply-crop-button');
  await page.waitForFunction((size) => {
    const canvas = document.querySelector('#preview');
    return `${canvas.width}x${canvas.height}` === size;
  }, expectedCropSize);
  assert.equal(await page.locator('#preview').evaluate((canvas) => `${canvas.width}x${canvas.height}`), expectedCropSize);
  assert.equal(await page.locator('#crop-selection').getAttribute('hidden'), '');
  assert.equal(await page.locator('#crop-output').textContent(), `${match[1]} × ${match[2]} px`);
  const appliedBox = await page.locator('#preview').boundingBox();
  await page.mouse.move(appliedBox.x + appliedBox.width / 2, appliedBox.y + appliedBox.height / 2);
  await page.waitForFunction(() => !document.querySelector('#brush-indicator').hidden);
  const croppedIndicator = await page.locator('#brush-indicator').evaluate((element) => ({
    width: parseFloat(element.style.width),
    brushSize: Number(document.querySelector('#brush-size').value),
    previewWidth: document.querySelector('#preview').width,
    previewHeight: document.querySelector('#preview').height,
  }));
  const appliedScale = Math.min(
    appliedBox.width / croppedIndicator.previewWidth,
    appliedBox.height / croppedIndicator.previewHeight,
  );
  assert.ok(
    Math.abs(croppedIndicator.width - croppedIndicator.brushSize * appliedScale) < 0.01,
    `cropped indicator does not follow active crop scale: ${JSON.stringify(croppedIndicator)}`,
  );

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
  const downloadBlobPromise = page.evaluate(() =>
    new Promise((resolve) => {
      const original = URL.createObjectURL;
      URL.createObjectURL = (blob) => {
        blob.arrayBuffer().then((buffer) => resolve(Array.from(new Uint8Array(buffer))));
        return original.call(URL, blob);
      };
    }),
  );
  const downloadPromise = page.waitForEvent('download');
  await page.click('#download-button');
  const [download, downloadBytes] = await Promise.all([
    downloadPromise,
    downloadBlobPromise,
  ]);
  assert.match(download.suggestedFilename(), /\.png$/);
  const downloadedBytes = Buffer.from(downloadBytes);
  assert.ok(downloadedBytes.length > 24);
  assert.equal(downloadedBytes.readUInt32BE(16), Number(match[1]));
  assert.equal(downloadedBytes.readUInt32BE(20), Number(match[2]));
  await page.click('#reset-crop-button');
  await page.waitForFunction(() => document.querySelector('#preview').width === 320);
  assert.equal(await page.locator('#preview').evaluate((canvas) => `${canvas.width}x${canvas.height}`), '320x240');
  assert.equal(await page.locator('#crop-output').textContent(), '完整图片');
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
