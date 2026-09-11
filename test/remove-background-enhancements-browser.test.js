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
    const target = path.resolve(build, `.${pathname}`);
    assert.ok(target.startsWith(`${build}${path.sep}`));
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
});
