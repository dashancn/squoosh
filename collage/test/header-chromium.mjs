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
const pages = [
  ['/', 'i41 图片压缩', '图片压缩'],
  ['/remove-background/', 'i41 智能抠图', '智能抠图'],
  ['/collage/', 'i41 多图拼接', '多图拼接'],
];

async function inspect(path, brand, current, width) {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 800 });
  await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav[aria-label="图片工具导航"]');
  const first = page.locator('nav[aria-label="图片工具导航"] [data-tooltip]').first();
  await first.hover();
  await page.waitForTimeout(250);
  const hoverOpacity = await first.evaluate((element) => getComputedStyle(element, '::after').opacity);
  await first.focus();
  await page.waitForTimeout(250);
  const focusTip = await first.evaluate((element) => {
    const style = getComputedStyle(element, '::after');
    const rect = element.getBoundingClientRect();
    return { opacity: style.opacity, content: style.content, position: style.position, left: style.left, right: style.right, iPlanWidth: rect.width };
  });
  return page.evaluate(({ path, brand, current, width, hoverOpacity, focusTip }) => {
    const nav = document.querySelector('nav[aria-label="图片工具导航"]');
    const labels = [...nav.querySelectorAll('a')].map((link) => link.textContent.trim());
    const brandElement = [...document.querySelectorAll('a')].find((element) => String(element.className).split(' ').some((name) => name.includes('brand')));
    return {
      path, width, brand: brandElement.textContent.replace('图', '').trim(), expectedBrand: brand,
      labels, currentPresent: labels.includes(current), targetBlankCount: document.querySelectorAll('[target="_blank"]').length,
      bannerPresent: Boolean(document.querySelector('[aria-label="关注 i方案"]')),
      detailsOpen: document.querySelector('details')?.open,
      navWidth: nav.clientWidth, navScrollWidth: nav.scrollWidth, scrollable: nav.scrollWidth > nav.clientWidth,
      hoverOpacity, focusTip,
    };
  }, { path, brand, current, width, hoverOpacity, focusTip });
}

const evidence = { chromiumVersion: await browser.version(), desktop: [], mobile: [], errors };
for (const [path, brand, current] of pages) evidence.desktop.push(await inspect(path, brand, current, 1280));
for (const [path, brand, current] of pages) evidence.mobile.push(await inspect(path, brand, current, 375));
await mkdir(join(root, '../collage/evidence'), { recursive: true });
await writeFile(join(root, '../collage/evidence/header-chromium.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
await browser.close();
await new Promise((resolve) => server.close(resolve));

const all = [...evidence.desktop, ...evidence.mobile];
if (
  errors.length ||
  all.some((entry) => entry.brand !== entry.expectedBrand || entry.currentPresent || entry.targetBlankCount || !entry.bannerPresent || entry.detailsOpen !== false || Number(entry.hoverOpacity) < 0.9 || Number(entry.focusTip.opacity) < 0.9 || !entry.focusTip.content.includes('方案') || entry.focusTip.iPlanWidth < 72) ||
  evidence.mobile.some((entry) => !entry.scrollable)
) process.exitCode = 1;
