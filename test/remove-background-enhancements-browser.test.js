import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../remove-background/node_modules/playwright-core/index.mjs';
import { findChromiumExecutable } from '../heic-converter/corresponding-source/rebuild/chromium-executable.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const build = path.join(root, 'build');
const server = createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(
      new URL(request.url, 'http://localhost').pathname,
    );
    if (pathname.endsWith('/')) pathname += 'index.html';
    const sourceModule = path.join(
      root,
      'remove-background/src/mask-editor.js',
    );
    const target =
      pathname === '/__source__/mask-editor.js'
        ? sourceModule
        : path.resolve(build, `.${pathname}`);
    assert.ok(
      target === sourceModule || target.startsWith(`${build}${path.sep}`),
    );
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript',
      '.mjs': 'text/javascript',
      '.css': 'text/css',
      '.wasm': 'application/wasm',
    };
    response.setHeader(
      'content-type',
      types[path.extname(target)] || 'application/octet-stream',
    );
    response.end(await readFile(target));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  executablePath: findChromiumExecutable(),
  headless: true,
  args: ['--no-sandbox'],
});
after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

test('Chromium exposes enhancement controls, accessible states and reset defaults', async () => {
  const page = await browser.newPage();
  await page.goto(
    `http://127.0.0.1:${server.address().port}/remove-background/`,
  );
  assert.equal(
    await page.locator('#compare-button').getAttribute('aria-pressed'),
    'false',
  );
  assert.equal(await page.locator('#compare-button').isDisabled(), true);
  assert.equal(await page.locator('#brush-hardness').inputValue(), '100');
  assert.equal(await page.locator('#crop-aspect').inputValue(), 'free');
  assert.deepEqual(
    await page.locator('#crop-aspect option').allTextContents(),
    ['自由', '原图', '1:1', '3:4', '4:3', '16:9'],
  );
  assert.deepEqual(
    await page
      .locator('#crop-aspect option')
      .evaluateAll((options) =>
        options.map((option) => [option.value, option.disabled]),
      ),
    [
      ['free', false],
      ['original', true],
      ['1:1', true],
      ['3:4', true],
      ['4:3', true],
      ['16:9', true],
    ],
    'presets remain unavailable until an active image can represent them',
  );
  assert.equal(await page.locator('#cleanup-level').inputValue(), 'off');
  assert.equal(
    await page.locator('#adjustments-panel').evaluate((node) => node.open),
    false,
  );
  for (const id of ['brightness', 'contrast', 'saturation'])
    assert.equal(await page.locator(`#${id}`).inputValue(), '0');
  await page.locator('#brightness').evaluate((node) => {
    node.value = '30';
  });
  await page.locator('#contrast').evaluate((node) => {
    node.value = '-20';
  });
  await page.locator('#effects-controls').evaluate((node) => {
    node.disabled = false;
  });
  await page.locator('#adjustments-panel summary').click();
  await page.locator('#reset-adjustments').click();
  for (const id of ['brightness', 'contrast', 'saturation'])
    assert.equal(await page.locator(`#${id}`).inputValue(), '0');
  assert.equal(
    await page.locator('#custom-background-color').getAttribute('aria-label'),
    '自定义背景颜色',
  );
  assert.equal(
    await page.locator('input[name="background"][value="custom"]').isChecked(),
    false,
  );
  const handles = page.locator('[data-crop-handle]');
  assert.equal(await handles.count(), 8);
  for (let index = 0; index < 8; index += 1) {
    assert.equal(
      await handles.nth(index).evaluate((node) => node.tagName),
      'BUTTON',
    );
    assert.ok(await handles.nth(index).getAttribute('aria-label'));
  }
});

test('Chromium makes a 4000x3000 JPEG preview-ready and enables Start after safe optimization', async () => {
  const page = await browser.newPage();
  await page.goto(
    `http://127.0.0.1:${server.address().port}/remove-background/`,
  );
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4000;
    canvas.height = 3000;
    const context = canvas.getContext('2d');
    context.fillStyle = '#c86432';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    );
    const file = new File([blob], 'camera-12mp.jpg', {
      type: 'image/jpeg',
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector('#file-input');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: transfer.files,
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    canvas.width = 0;
    canvas.height = 0;
  });

  await page.waitForFunction(
    () =>
      !document.querySelector('#start-button').disabled &&
      document.querySelector('#status').textContent.includes('已优化'),
  );
  assert.match(
    await page.locator('#status').textContent(),
    /4000 × 3000 → 3265 × 2449 px.*预览已就绪/,
  );
  assert.match(
    await page.locator('#file-name').textContent(),
    /camera-12mp\.jpg.*4000 × 3000 → 3265 × 2449 px/,
  );
  assert.equal(await page.locator('#preview-empty').isHidden(), true);
  assert.equal(await page.locator('#preview').getAttribute('width'), '1200');
  assert.equal(await page.locator('#preview').getAttribute('height'), '900');
  await page.close();
});

test('Chromium preprocessing preserves transparent PNG bytes mislabeled JPEG', async () => {
  const page = await browser.newPage();
  await page.goto(
    `http://127.0.0.1:${server.address().port}/remove-background/`,
  );
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4000;
    canvas.height = 3000;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ff0000';
    context.fillRect(2000, 0, 2000, 3000);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    const file = new File([blob], 'alpha-camera.jpg', { type: 'image/jpeg' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector('#file-input');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: transfer.files,
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    canvas.width = 0;
    canvas.height = 0;
    await new Promise((resolve, reject) => {
      const deadline = performance.now() + 10000;
      const check = () => {
        if (!document.querySelector('#start-button').disabled) return resolve();
        if (performance.now() > deadline)
          return reject(new Error('preview timeout'));
        requestAnimationFrame(check);
      };
      check();
    });
    const preview = document.querySelector('#preview');
    const pixels = preview.getContext('2d').getImageData(0, 0, 1200, 900).data;
    return {
      transparentAlpha: pixels[3],
      opaqueAlpha: pixels[600 * 4 + 3],
    };
  });
  assert.equal(result.transparentAlpha, 0);
  assert.equal(result.opaqueAlpha, 255);
  await page.close();
});

test('Chromium aspect recrop path uses active-crop local coordinates', async () => {
  const main = await readFile(
    path.join(root, 'remove-background/src/main.js'),
    'utf8',
  );
  assert.match(main, /normalizeAspectCropWithin/);
  assert.match(main, /activeCropBounds\(\)/);
  assert.doesNotMatch(
    main,
    /normalizeAspectCropRect\(\s*cropStart,\s*point,\s*sourceWidth,\s*sourceHeight/s,
  );
  const page = await browser.newPage();
  await page.goto(
    `http://127.0.0.1:${server.address().port}/remove-background/`,
  );
  const crops = await page.evaluate(async () => {
    const { normalizeAspectCropWithin } = await import(
      '/__source__/mask-editor.js'
    );
    const applied = { x: 100, y: 50, width: 80, height: 45 };
    return [
      normalizeAspectCropWithin(
        { x: 100, y: 50 },
        { x: 100, y: 50 },
        applied,
        16 / 9,
      ),
      normalizeAspectCropWithin(
        { x: 179, y: 94 },
        { x: 0, y: 0 },
        applied,
        16 / 9,
      ),
    ];
  });
  for (const crop of crops) {
    assert.ok(crop.x >= 100 && crop.y >= 50);
    assert.ok(crop.x + crop.width <= 180);
    assert.ok(crop.y + crop.height <= 95);
  }
  await page.close();
});
