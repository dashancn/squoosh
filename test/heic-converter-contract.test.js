import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

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
  assert.match(html, /libde265[^]*1\.0\.16/);
  assert.match(html, /LGPL-3\.0/);
  assert.match(html, /third-party\/heic-to-v1\.5\.2\.tar\.gz/);
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

test('converter build relies on the single compatible root CSP without appending a duplicate policy', async () => {
  const [buildScript, rootHeaders] = await Promise.all([
    read('heic-converter/build.mjs'),
    read('src/static-build/index.tsx'),
  ]);
  assert.doesNotMatch(buildScript, /resolve\(destination, '_headers'\)/);
  assert.doesNotMatch(buildScript, /resolve\(destination, '\.\.\/_headers'\)/);
  assert.doesNotMatch(buildScript, /Content-Security-Policy/);
  assert.match(
    rootHeaders,
    /script-src 'self' blob: 'wasm-unsafe-eval' 'unsafe-eval'/,
  );
  assert.match(rootHeaders, /worker-src 'self' blob:/);
  assert.doesNotMatch(rootHeaders, /Cross-Origin-Embedder-Policy/);
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
  assert.match(html, /third-party\/heic-to-v1\.5\.2\.tar\.gz/);
  assert.match(html, /third-party\/libheif-v1\.22\.2\.tar\.gz/);
  assert.match(html, /third-party\/libde265-1\.0\.16\.tar\.gz/);
  assert.match(html, /完整对应源代码/);
  assert.match(buildScript, /esbuild\.mjs/);
  assert.match(buildScript, /BUILD-AND-RELINK\.md/);
  assert.match(buildScript, /CORRESPONDING-SOURCE\.md/);
});

test('built HEIC distribution carries exact complete corresponding source below Pages file limits', async () => {
  const thirdParty = new URL(
    '../build/heic-converter/third-party/',
    import.meta.url,
  );
  const expected = {
    'heic-to-v1.5.2.tar.gz':
      '8beb13f9f09e444a2955a4e1f129f5a1458e15b6e7fd898ec38c857090296544',
    'libheif-v1.22.2.tar.gz':
      'af30a8b32dfbc1dc86a7f0f55a53107dad35010a65ebf1feb468082e402b11e0',
    'libde265-1.0.16.tar.gz':
      'b92beb6b53c346db9a8fae968d686ab706240099cdd5aff87777362d668b0de7',
  };
  for (const [name, digest] of Object.entries(expected)) {
    const url = new URL(name, thirdParty);
    const bytes = await readFile(url);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      digest,
      name,
    );
    assert.ok(
      (await stat(url)).size < 25 * 1024 * 1024,
      `${name} exceeds Cloudflare Pages' per-file limit`,
    );
  }
  const requiredText = [
    'CORRESPONDING-SOURCE.md',
    'SHA256SUMS',
    'LICENSES/heic-to-LGPL-3.0.txt',
    'LICENSES/libheif-LGPL-3.0.txt',
    'LICENSES/libde265-LGPL-3.0.txt',
    'rebuild/heic-to-worker-entry.mjs',
    'rebuild/build.mjs',
    'rebuild/package.json',
    'rebuild/package-lock.json',
    'rebuild/rebuild-and-verify.mjs',
  ];
  const contents = await Promise.all(
    requiredText.map(async (name) => [
      name,
      await readFile(new URL(name, thirdParty), 'utf8'),
    ]),
  );
  const manifest = contents.find(
    ([name]) => name === 'CORRESPONDING-SOURCE.md',
  )[1];
  assert.match(manifest, /libde265[^\n]*1\.0\.16/);
  assert.match(manifest, /USE_UNSAFE_EVAL=0/);
  assert.match(manifest, /USE_WASM=0/);
  assert.match(manifest, /LIBDE265_VERSION=1\.0\.16/);
  assert.match(manifest, /not byte-for-byte reproducible/i);
  assert.match(manifest, /rebuild-and-verify\.mjs/);
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

test('converter mobile header contains menu before the i方案 banner', async () => {
  const [html, css] = await Promise.all([
    read('heic-converter/index.html'),
    read('heic-converter/style.css'),
  ]);
  assert.ok(html.indexOf('</header>') < html.indexOf('class="i-plan-banner"'));
  assert.doesNotMatch(
    css,
    /@media\s*\(max-width:\s*700px\)[\s\S]*?\.header-inner\s*\{[^}]*display:\s*block/,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*700px\)[\s\S]*?\.site-header\s*\{[^}]*height:\s*auto/,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*700px\)[\s\S]*?\.header-inner\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*700px\)[\s\S]*?\.tool-nav\s*\{[^}]*flex-basis:\s*100%[^}]*justify-content:\s*flex-end/,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*700px\)[\s\S]*?\.privacy-badge\s*\{[^}]*margin-left:\s*auto/,
  );
});

test('root build registers route-specific converter build', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(
    pkg.scripts['build:heic-converter'],
    'npm --prefix heic-converter run build',
  );
  assert.match(pkg.scripts.build, /build:heic-converter/);
});
