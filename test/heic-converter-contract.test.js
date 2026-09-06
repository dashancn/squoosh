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

test('sensitive converter route loads no analytics and states its exact privacy contract', async () => {
  const html = await read('heic-converter/index.html');
  assert.doesNotMatch(html, /stats\.i41\.cn|analytics\.js/i);
  assert.match(html, /不加载统计脚本/);
  assert.match(html, /不会上传文件/);
  assert.match(html, /data-i41-site="heic-converter"/);
});

test('converter build emits a restrictive route-specific CSP without weakening other routes', async () => {
  const buildScript = await read('heic-converter/build.mjs');
  assert.match(buildScript, /resolve\(destination, '_headers'\)/);
  assert.match(buildScript, /resolve\(destination, '\.\.\/_headers'\)/);
  assert.match(buildScript, /default-src 'self'/);
  assert.match(buildScript, /script-src 'self'/);
  assert.match(buildScript, /worker-src 'self' blob:/);
  assert.match(buildScript, /img-src 'self' data: blob:/);
  assert.match(buildScript, /connect-src 'none'/);
});

test('LGPL notice is visible and distribution includes pinned corresponding-source materials', async () => {
  const [html, buildScript] = await Promise.all([
    read('heic-converter/index.html'),
    read('heic-converter/build.mjs'),
  ]);
  const beforeDetails = html.split('<details>')[0];
  assert.match(beforeDetails, /heic-to 1\.5\.2/);
  assert.match(beforeDetails, /libheif 1\.22\.2/);
  assert.match(beforeDetails, /LGPL-3\.0/);
  assert.match(html, /github\.com\/hoppergee\/heic-to\/tree\/v1\.5\.2/);
  assert.match(html, /github\.com\/strukturag\/libheif\/tree\/v1\.22\.2/);
  assert.doesNotMatch(html, /完整对应源代码/);
  assert.match(buildScript, /esbuild\.mjs/);
  assert.match(buildScript, /BUILD-AND-RELINK\.md/);
  assert.match(buildScript, /libheif-1\.22\.2-SOURCE\.txt/);
});

test('converter download-all keeps downloads in the click gesture without delayed timers', async () => {
  const app = await read('heic-converter/src/app.mjs');
  const handler =
    app.match(/\$\('download-all'\)[^]*?window\.addEventListener/)?.[0] || '';
  assert.match(handler, /for \(const item of results\)/);
  assert.match(handler, /a\.click\(\)/);
  assert.doesNotMatch(handler, /setTimeout/);
});

test('converter UI snapshots batch settings, locks mutation controls, and avoids filename innerHTML', async () => {
  const app = await read('heic-converter/src/app.mjs');
  assert.match(app, /const settings = Object\.freeze/);
  assert.match(app, /setConverting\(true\)/);
  assert.match(app, /input\.disabled = busy/);
  assert.match(app, /format\.disabled = busy/);
  assert.match(app, /quality\.disabled = busy/);
  assert.match(app, /background\.disabled = busy/);
  assert.doesNotMatch(app, /selection'\)\.innerHTML/);
  assert.doesNotMatch(app, /card\.innerHTML/);
  assert.match(app, /canvas\.width = 1/);
  assert.match(app, /canvas\.height = 1/);
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
