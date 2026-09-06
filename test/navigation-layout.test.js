import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../remove-background/node_modules/playwright-core/index.mjs';
import { findChromiumExecutable } from '../heic-converter/corresponding-source/rebuild/chromium-executable.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const build = path.join(root, 'build');
const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.wasm', 'application/wasm'],
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
    response.writeHead(200, {
      'content-type':
        types.get(path.extname(target)) || 'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end('not found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: findChromiumExecutable(),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

async function verifyCase(pathname, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const diagnostics = [];
  page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error}`));
  try {
    await page.goto(`${origin}${pathname}`, {
      waitUntil: 'domcontentloaded',
      timeout: 10_000,
    });
    const nav = page.locator('nav[aria-label="图片工具导航"]');
    await nav.waitFor({ timeout: 5_000 });
    const layout = await nav.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const last = element.lastElementChild.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        navOverflowX: style.overflowX,
        navFlexWrap: style.flexWrap,
        navJustify: style.justifyContent,
        navClientWidth: element.clientWidth,
        navScrollWidth: element.scrollWidth,
        navRight: rect.right,
        lastRight: last.right,
        itemTops: [...element.children].map(
          (item) => item.getBoundingClientRect().top,
        ),
      };
    });
    assert.equal(layout.scrollWidth, layout.documentWidth, '页面横向溢出');
    assert.notEqual(layout.navOverflowX, 'auto');
    assert.notEqual(layout.navOverflowX, 'scroll');
    assert.equal(layout.navFlexWrap, 'wrap');
    assert.equal(layout.navJustify, 'flex-end');
    assert.equal(
      layout.navScrollWidth,
      layout.navClientWidth,
      '导航仍可横向滚动',
    );
    assert.ok(Math.abs(layout.navRight - layout.lastRight) <= 1, '菜单未靠右');
    if (width === 1280)
      assert.equal(new Set(layout.itemTops).size, 1, '桌面导航不是单行');

    if (pathname === '/') {
      const homepage = await page.evaluate(() => ({
        hasUpload: Boolean(document.querySelector('input[type="file"]')),
        hasDemos: Boolean(document.querySelector('[class*="demos"]')),
        hasInfo: Boolean(document.querySelector('[class*="info_"]')),
        hasCompactBenefits: Boolean(
          document.querySelector('[class*="compact-benefits"]'),
        ),
        pageHeight: document.documentElement.scrollHeight,
      }));
      assert.equal(homepage.hasUpload, true, '上传入口不可用');
      assert.equal(homepage.hasDemos, false, '仍显示示例列表');
      assert.equal(homepage.hasInfo, false, '仍显示大型信息区');
      assert.equal(homepage.hasCompactBenefits, true, '缺少紧凑说明');
      assert.ok(homepage.pageHeight < 1400, '首页仍然过长');
    }

    const firstItem = nav.locator('a').first();
    await firstItem.hover({ timeout: 5_000 });
    await firstItem.evaluate(
      (item) =>
        new Promise((resolve, reject) => {
          const deadline = performance.now() + 2_000;
          const check = () => {
            if (getComputedStyle(item, '::after').opacity === '1') resolve();
            else if (performance.now() >= deadline)
              reject(new Error('hover tooltip 未显示'));
            else requestAnimationFrame(check);
          };
          check();
        }),
    );
    await page.mouse.move(0, 899);
    await firstItem.focus();
    await firstItem.evaluate(
      (item) =>
        new Promise((resolve, reject) => {
          const deadline = performance.now() + 2_000;
          const check = () => {
            if (getComputedStyle(item, '::after').opacity === '1') resolve();
            else if (performance.now() >= deadline)
              reject(new Error('focus tooltip 未显示'));
            else requestAnimationFrame(check);
          };
          check();
        }),
    );
    assert.deepEqual(diagnostics, []);
  } catch (error) {
    error.message = `${pathname} ${width}px: ${
      error.message
    }; diagnostics=${JSON.stringify(diagnostics)}`;
    throw error;
  } finally {
    await page.close();
  }
}

describe('导航布局和 tooltip', { concurrency: false }, () => {
  for (const width of [1280, 375]) {
    for (const pathname of ['/', '/remove-background/', '/collage/']) {
      test(`${pathname} ${width}px`, { timeout: 15_000 }, () =>
        verifyCase(pathname, width),
      );
    }
  }
});
