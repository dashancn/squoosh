import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('picker and drop share the same HEIC adapter path before opening the editor', async () => {
  const app = await read('src/client/initial-app/App/index.tsx');
  assert.match(app, /onFileDrop[^]*heicInput\.select\(files\[0\]\)/);
  assert.match(app, /onIntroPickFile[^]*heicInput\.select\(file\)/);
  assert.match(app, /openSelectedFile[^]*openEditor/);
  const dropHandler = app.match(/private onFileDrop[^]*?\n  };/)?.[0] || '';
  const pickerHandler =
    app.match(/private onIntroPickFile[^]*?\n  };/)?.[0] || '';
  assert.doesNotMatch(dropHandler, /openEditor/);
  assert.doesNotMatch(pickerHandler, /openEditor/);
});

test('compressor HEIC path is lazy and points at converter same-origin worker assets', async () => {
  const [app, loader] = await Promise.all([
    read('src/client/initial-app/App/index.tsx'),
    read('src/client/initial-app/heic-worker-loader.ts'),
  ]);
  assert.doesNotMatch(app, /heic-converter\/src\/heic-worker/);
  assert.match(loader, /import\('\.\/heic-worker-client\.mjs'\)/);
  assert.match(loader, /\/heic-converter\/src\/heic-worker\.mjs/);
  assert.match(loader, /type:\s*'module'/);
});

test('HEIC operational notice has readiness, metadata, and visible LGPL source links', async () => {
  const [app, input] = await Promise.all([
    read('src/client/initial-app/App/index.tsx'),
    read('src/client/initial-app/heic-input.mjs'),
  ]);
  assert.match(app, /heicNotice/);
  assert.match(app, /\/heic-converter\/.*许可|许可.*\/heic-converter\//);
  assert.match(app, /对应源代码/);
  assert.match(input, /3\.0 MB.*0\.8 MB/);
  assert.match(input, /元数据\/EXIF/);
  assert.match(input, /heic-to.*libheif.*libde265.*LGPL-3\.0/);
});

test('converter build keeps one HEIC runtime and exposes it without initial compressor precache', async () => {
  const [buildScript, swCache] = await Promise.all([
    read('heic-converter/build.mjs'),
    read('src/sw/to-cache.ts'),
  ]);
  assert.match(buildScript, /heic-to-1\.5\.2\.worker\.js/);
  assert.doesNotMatch(swCache, /heic-to|heic-worker/);
});

test('generated root headers protect the compressor while permitting HEIC workers', async () => {
  const headers = await read('build/_headers');
  const root = headers.split('\n/heic-converter/*')[0];
  assert.match(root, /Content-Security-Policy:/);
  assert.match(root, /default-src 'self'/);
  assert.match(
    root,
    /script-src 'self' blob: 'wasm-unsafe-eval' 'unsafe-eval'/,
  );
  assert.match(root, /worker-src 'self' blob:/);
  assert.match(root, /img-src 'self' data: blob:/);
  assert.match(root, /font-src 'self' data:/);
  assert.match(root, /style-src 'self' 'unsafe-inline'/);
  assert.match(root, /connect-src 'self' blob:/);
  assert.doesNotMatch(root, /Cross-Origin-Embedder-Policy/);
  assert.doesNotMatch(root, /Cross-Origin-Opener-Policy/);
  assert.doesNotMatch(root, /Cross-Origin-Resource-Policy/);
});
