import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

const run = promisify(execFile);
const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const built = (path) =>
  readFile(new URL(`../build/${path}`, import.meta.url), 'utf8');

before(async () => {
  await run('npm', ['run', 'build'], { cwd: root, timeout: 300_000 });
});

test('首页使用 imgzip.i41.cn canonical 和 i41 社交品牌', async () => {
  const html = await built('index.html');
  assert.match(html, /<title>i41 图片压缩 - 在线压缩与格式转换<\/title>/);
  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/imgzip\.i41\.cn\/" \/>/,
  );
  assert.match(
    html,
    /<meta property="og:url" content="https:\/\/imgzip\.i41\.cn\/" \/>/,
  );
  assert.match(
    html,
    /<meta property="og:site_name" content="i41 图片工具" \/>/,
  );
  assert.match(
    html,
    /<meta property="og:title" content="i41 图片压缩 - 在线压缩与格式转换" \/>/,
  );
  assert.match(
    html,
    /<meta name="twitter:title" content="i41 图片压缩 - 在线压缩与格式转换" \/>/,
  );
  assert.doesNotMatch(
    html,
    /squoosh\.app|@SquooshApp|在线图片压缩工具 - Squoosh/,
  );
});

test('四个生产页面提供对应 canonical、OG、Twitter 和 WebApplication JSON-LD', async () => {
  const pages = [
    ['index.html', '/', 'i41 图片压缩'],
    ['heic-converter/index.html', '/heic-converter/', 'i41 HEIC 转换'],
    ['remove-background/index.html', '/remove-background/', 'i41 智能抠图'],
    ['collage/index.html', '/collage/', 'i41 多图拼接'],
  ];

  for (const [file, path, name] of pages) {
    const html = await built(file);
    const url = `https://imgzip.i41.cn${path}`;
    assert.ok(html.includes(`rel="canonical" href="${url}"`), file);
    assert.ok(html.includes(`property="og:url" content="${url}"`), file);
    assert.match(html, /property="og:title" content="[^"]+"/);
    assert.match(html, /property="og:description" content="[^"]+"/);
    assert.match(
      html,
      /property="og:image" content="https:\/\/imgzip\.i41\.cn\/[^"]+"/,
    );
    assert.match(html, /name="twitter:card" content="summary"/);
    assert.match(html, /name="twitter:title" content="[^"]+"/);
    assert.match(html, /name="twitter:description" content="[^"]+"/);
    assert.match(
      html,
      /name="twitter:image" content="https:\/\/imgzip\.i41\.cn\/[^"]+"/,
    );

    const jsonText = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    )?.[1];
    assert.ok(jsonText, `${file} 缺少 JSON-LD`);
    const data = JSON.parse(jsonText.replaceAll('&quot;', '"'));
    assert.equal(data['@context'], 'https://schema.org');
    assert.equal(data['@type'], 'WebApplication');
    assert.equal(data.name, name);
    assert.equal(data.url, url);
    assert.equal(data.applicationCategory, 'MultimediaApplication');
    assert.equal(data.operatingSystem, 'Any');
    assert.deepEqual(data.offers, {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'CNY',
    });
  }
});

test('robots.txt 允许抓取并指向 sitemap.xml', async () => {
  const robots = await built('robots.txt');
  assert.equal(
    robots,
    'User-agent: *\nAllow: /\nSitemap: https://imgzip.i41.cn/sitemap.xml\n',
  );
});

test('sitemap.xml 是包含四个标准路径的有效 URL 集', async () => {
  const sitemap = await built('sitemap.xml');
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(
    sitemap,
    /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/,
  );
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    ([, url]) => url,
  );
  assert.deepEqual(locations, [
    'https://imgzip.i41.cn/',
    'https://imgzip.i41.cn/heic-converter/',
    'https://imgzip.i41.cn/remove-background/',
    'https://imgzip.i41.cn/collage/',
  ]);
  assert.equal(new Set(locations).size, 4);
  assert.match(sitemap, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
});
