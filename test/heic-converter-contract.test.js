import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('independent converter route is local-only, iframe-free, and has complete LGPL notices', async () => {
  const [html, pkg, rootLicense] = await Promise.all([
    read('heic-converter/index.html'),
    read('heic-converter/package.json'),
    read('LICENSE'),
  ]);
  assert.match(html, /i41 HEIC 转换/);
  assert.match(html, /图片仅在本地处理/);
  assert.doesNotMatch(html, /<iframe|<form[^>]+action=|upload/i);
  assert.match(html, /heic-to[^]*1\.5\.2/);
  assert.match(html, /libheif[^]*1\.22\.2/);
  assert.match(html, /LGPL-3\.0/);
  assert.match(html, /github\.com\/hoppergee\/heic-to/);
  assert.match(html, /重新链接|relink/i);
  assert.equal(JSON.parse(pkg).dependencies['heic-to'], '1.5.2');
  assert.match(rootLicense, /Apache License[^]*Version 2\.0/);
});

test('all four image pages link converter in global order and omit their current item', async () => {
  const paths = [
    'src/shared/prerendered-app/Intro/index.tsx',
    'remove-background/index.html',
    'collage/index.html',
    'heic-converter/index.html',
  ];
  const pages = await Promise.all(paths.map(read));
  for (const source of pages) {
    const nav = source.match(/<nav[^]*?<\/nav>/)?.[0];
    assert.ok(nav);
    const labels = [...nav.matchAll(/<a\b[^>]*>\s*([^<]+)\s*<\/a>/g)].map((m) =>
      m[1].trim(),
    );
    if (!source.includes('i41 HEIC 转换'))
      assert.ok(nav.includes('href="/heic-converter/"'));
    else assert.doesNotMatch(nav, />\s*HEIC 转换\s*</);
    const compressor = labels.indexOf('图片压缩');
    const converter = labels.indexOf('HEIC 转换');
    const remover = labels.indexOf('智能抠图');
    if (converter >= 0 && compressor >= 0) assert.ok(compressor < converter);
    if (converter >= 0 && remover >= 0) assert.ok(converter < remover);
  }
});

test('root build registers route-specific converter build', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(
    pkg.scripts['build:heic-converter'],
    'npm --prefix heic-converter run build',
  );
  assert.match(pkg.scripts.build, /build:heic-converter/);
});
