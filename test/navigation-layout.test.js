import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../remove-background/node_modules/playwright-core/index.mjs';

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
after(() => new Promise((resolve) => server.close(resolve)));

test('三个图片工具导航在桌面和窄屏均换行右对齐且 tooltip 可见', async () => {
  const browser = await chromium.launch({
    executablePath: '/snap/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    for (const width of [1280, 375]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      for (const pathname of ['/', '/remove-background/', '/collage/']) {
        await page.goto(`${origin}${pathname}`, {
          waitUntil: 'domcontentloaded',
        });
        const layout = await page
          .locator('nav[aria-label="图片工具导航"]')
          .evaluate((nav) => {
            const style = getComputedStyle(nav);
            const rect = nav.getBoundingClientRect();
            const last = nav.lastElementChild.getBoundingClientRect();
            return {
              documentWidth: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
              navOverflowX: style.overflowX,
              navFlexWrap: style.flexWrap,
              navJustify: style.justifyContent,
              navClientWidth: nav.clientWidth,
              navScrollWidth: nav.scrollWidth,
              navRight: rect.right,
              lastRight: last.right,
              itemTops: [...nav.children].map(
                (item) => item.getBoundingClientRect().top,
              ),
            };
          });
        assert.equal(
          layout.scrollWidth,
          layout.documentWidth,
          `${pathname} ${width}px 页面横向溢出`,
        );
        assert.notEqual(layout.navOverflowX, 'auto');
        assert.notEqual(layout.navOverflowX, 'scroll');
        assert.equal(layout.navFlexWrap, 'wrap');
        assert.equal(layout.navJustify, 'flex-end');
        assert.equal(
          layout.navScrollWidth,
          layout.navClientWidth,
          `${pathname} ${width}px 导航仍可横向滚动`,
        );
        assert.ok(
          Math.abs(layout.navRight - layout.lastRight) <= 1,
          `${pathname} ${width}px 菜单未靠右`,
        );
        if (width === 1280) {
          assert.equal(
            new Set(layout.itemTops).size,
            1,
            `${pathname} 桌面导航不是单行`,
          );
        }

        const firstItem = page
          .locator('nav[aria-label="图片工具导航"] a')
          .first();
        await firstItem.hover();
        await page.waitForFunction(
          (item) => getComputedStyle(item, '::after').opacity === '1',
          await firstItem.elementHandle(),
        );
        await page.mouse.move(0, 899);
        await firstItem.focus();
        await page.waitForFunction(
          (item) => getComputedStyle(item, '::after').opacity === '1',
          await firstItem.elementHandle(),
        );
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
