import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from '../remove-background/node_modules/playwright-core/index.mjs';
import { findChromiumExecutable } from '../heic-converter/corresponding-source/rebuild/chromium-executable.mjs';

const root = new URL('../build/', import.meta.url).pathname;
const types = { '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    let file = normalize(join(root, pathname));
    if (!file.startsWith(root)) throw new Error('invalid path');
    if (pathname.endsWith('/')) file = join(file, 'index.html');
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch {
    response.statusCode = 404;
    response.end('Not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const routes = ['/', '/heic-converter/', '/remove-background/', '/collage/'];
const browser = await chromium.launch({ executablePath: findChromiumExecutable(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const results = [];
try {
  const page = await browser.newPage();
  for (const route of routes) {
    await page.goto(`${origin}${route}`, { waitUntil: 'domcontentloaded' });
    const metadata = await page.evaluate(() => ({
      canonical: document.querySelector('link[rel="canonical"]')?.href,
      ogUrl: document.querySelector('meta[property="og:url"]')?.content,
      twitter: document.querySelector('meta[name="twitter:card"]')?.content,
      jsonLd: JSON.parse(document.querySelector('script[type="application/ld+json"]')?.textContent || 'null'),
    }));
    const expected = `https://imgzip.i41.cn${route}`;
    assert.equal(metadata.canonical, expected);
    assert.equal(metadata.ogUrl, expected);
    assert.equal(metadata.twitter, 'summary');
    assert.equal(metadata.jsonLd?.url, expected);
    assert.equal(metadata.jsonLd?.['@type'], 'WebApplication');
    results.push({ route, ...metadata });
  }
  for (const [path, expectedType] of [['/robots.txt', 'text/plain'], ['/sitemap.xml', 'application/xml']]) {
    const response = await page.request.get(`${origin}${path}`);
    assert.equal(response.status(), 200);
    assert.ok(response.headers()['content-type'].startsWith(expectedType));
  }
  console.log(JSON.stringify({ chromium: await browser.version(), routes: results.map(({ route, canonical }) => ({ route, canonical })) }, null, 2));
} finally {
  await browser.close();
  server.close();
}
