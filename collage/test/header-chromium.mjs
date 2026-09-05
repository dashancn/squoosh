import { chromium } from '../../remove-background/node_modules/playwright-core/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('../../build', import.meta.url).pathname;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.endsWith('/') ? `${pathname.slice(1)}index.html` : pathname.slice(1);
    const file = normalize(join(root, relative || 'index.html'));
    if (!file.startsWith(root)) throw new Error('invalid path');
    response.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch {
    response.statusCode = 404;
    response.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
const paths = ['/', '/remove-background/', '/collage/'];
const desktop = [];
for (const path of paths) {
  await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => [...document.querySelectorAll('*')].some((element) => element.className && String(element.className).includes('site-header')));
  desktop.push(await page.evaluate((currentPath) => {
    const find = (name) => [...document.querySelectorAll('*')].find((element) => element.className && String(element.className).split(' ').some((className) => className.includes(name)));
    const box = (name) => {
      const rect = find(name).getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    return {
      path: currentPath,
      header: box('site-header'),
      inner: box('header-inner'),
      brand: box('brand'),
      nav: box('tool-nav'),
      privacyBadge: box('privacy-badge'),
      banner: box('i-plan-banner'),
      labels: [...find('tool-nav').querySelectorAll('a')].map((link) => link.textContent.trim()),
      active: find('tool-nav').querySelector('[aria-current="page"]')?.textContent.trim(),
      iPlanStyle: { backgroundColor: getComputedStyle(find('i-plan-nav')).backgroundColor, color: getComputedStyle(find('i-plan-nav')).color },
    };
  }, path));
}
await page.setViewportSize({ width: 375, height: 812 });
const mobile = [];
for (const path of paths) {
  await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => [...document.querySelectorAll('*')].some((element) => element.className && String(element.className).includes('site-header')));
  mobile.push(await page.evaluate((currentPath) => {
    const find = (name) => [...document.querySelectorAll('*')].find((element) => element.className && String(element.className).split(' ').some((className) => className.includes(name)));
    const header = find('site-header').getBoundingClientRect();
    const nav = find('tool-nav').getBoundingClientRect();
    const privacyBadge = find('privacy-badge').getBoundingClientRect();
    const labels = [...find('tool-nav').querySelectorAll('a')].map((link) => link.textContent.trim());
    return { path: currentPath, headerHeight: header.height, navWidth: nav.width, navRight: nav.right, navScrollWidth: find('tool-nav').scrollWidth, privacyBadgeRight: privacyBadge.right, labels, viewportWidth: document.documentElement.clientWidth };
  }, path));
}
const evidence = { chromiumVersion: await browser.version(), desktop, mobile, errors };
await mkdir(join(root, '../collage/evidence'), { recursive: true });
await writeFile(join(root, '../collage/evidence/header-chromium.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
await browser.close();
await new Promise((resolve) => server.close(resolve));
const reference = desktop[0];
const expectedLabels = 'i方案|开发者工具|图片压缩|智能抠图|多图拼接|PDF 工具|证件水印|临时剪贴板|证件照';
const expectedActive = { '/': '图片压缩', '/remove-background/': '智能抠图', '/collage/': '多图拼接' };
if (errors.length || desktop.some((entry) => Math.abs(entry.header.height - 64) > 1 || entry.inner.x !== reference.inner.x || entry.brand.x !== reference.brand.x || entry.banner.x !== reference.inner.x || entry.banner.width !== reference.inner.width || entry.labels.join('|') !== expectedLabels || entry.active !== expectedActive[entry.path] || entry.iPlanStyle.backgroundColor !== 'rgb(23, 105, 224)' || entry.iPlanStyle.color !== 'rgb(255, 255, 255)') || mobile.some((entry) => entry.navRight > entry.viewportWidth || entry.privacyBadgeRight > entry.viewportWidth || entry.headerHeight < 64 || entry.labels.join('|') !== expectedLabels || entry.navScrollWidth <= entry.navWidth)) process.exitCode = 1;
