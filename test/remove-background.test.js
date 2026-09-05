import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const requiredNav = [
  ['图片压缩', '/'],
  ['智能抠图', '/remove-background/'],
  ['多图拼接', '/collage/'],
];

test('独立抠图页面提供完整操作且不使用 iframe 或工作区跳转', async () => {
  const html = await read('remove-background/index.html');
  const source = await read('remove-background/src/main.js');

  for (const id of [
    'file-input',
    'start-button',
    'progress',
    'preview',
    'download-button',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const background of ['transparent', 'white', 'blue', 'red']) {
    assert.match(html, new RegExp(`value="${background}"`));
  }
  assert.doesNotMatch(
    html + source,
    /<iframe|workspace|location\.(?:assign|replace)|window\.location\s*=/i,
  );
  assert.match(source, /removeBackground\(/);
  assert.match(source, /image\/png/);
});

test('页面使用统一图片工具导航和 i41 生态入口', async () => {
  const html = await read('remove-background/index.html');
  for (const [label, href] of requiredNav) {
    assert.match(html, new RegExp(`href="${href}"[^>]*>[\\s\\S]*?${label}`));
  }
  for (const [label, href] of [
    ['开发者工具', 'https://tools.i41.cn'],
    ['证件照', 'https://idphoto.i41.cn'],
    ['PDF 工具', 'https://pdf.i41.cn'],
    ['证件水印', 'https://watermark.i41.cn'],
    ['临时剪贴板', 'https://clip.i41.cn'],
  ]) {
    assert.ok(html.includes(`href="${href}"`), `缺少 ${label}`);
    assert.match(html, new RegExp(`>\\s*${label}\\s*<`));
  }
  assert.match(
    html,
    /www\.i41\.cn\?utm_source=imgzip&amp;utm_medium=tool_referral&amp;utm_campaign=ifangan&amp;utm_content=ecosystem_nav/,
  );
});

test('页面准确说明 54MB 首次资源、隐私和 IMG.LY AGPL 归属', async () => {
  const html = await read('remove-background/index.html');
  assert.match(html, /首次抠图需从本站加载约 54MB/);
  assert.match(html, /图片仅在浏览器本地处理/);
  assert.match(html, /不会上传图片/);
  assert.match(html, /IMG\.LY/);
  assert.match(html, /GNU AGPL v3/);
  assert.match(html, /不提供任何担保/);
  assert.match(html, /对应源代码/);
  await stat(new URL('../remove-background/LICENSE-AGPL.md', import.meta.url));
});

test('抠图固定使用同源 isnet_quint8 资源', async () => {
  const source = await read('remove-background/src/main.js');
  const resources = JSON.parse(
    await read('remove-background/public/imgly/resources.json'),
  );
  assert.match(
    source,
    /publicPath:\s*new URL\('\.\/imgly\/', location\.href\)\.href/,
  );
  assert.match(source, /model:\s*'isnet_quint8'/);
  assert.ok(resources['/models/isnet_quint8']);
  assert.equal(resources['/models/isnet_quint8'].size, 44348940);
  assert.ok(resources['/onnxruntime-web/ort-wasm-simd-threaded.wasm']);
});

test('生产构建接入 /remove-background/ 且保留独立入口', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  assert.match(packageJson.scripts.build, /build:remove-background/);
  assert.ok(packageJson.scripts['build:remove-background']);
  const config = await read('remove-background/vite.config.js');
  assert.match(config, /build\/remove-background/);
});
