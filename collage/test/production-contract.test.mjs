import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const requiredNav = [
  ['图片压缩', '/'],
  ['智能抠图', '/remove-background/'],
  ['多图拼接', '/collage/'],
];

test('独立拼图页面提供多图上传、三种模式和 PNG 预览下载', async () => {
  const [html, source] = await Promise.all([read('index.html'), read('src/app.mjs')]);

  assert.match(html, /data-i41-site="imgzip"/);
  assert.match(html, /id="files"[^>]*multiple/);
  for (const mode of ['grid', 'nine-grid', 'vertical', 'horizontal', 'two-columns', 'two-rows', 'three-feature', 'four-grid', 'left-stack-right-feature', 'top-feature-bottom-pair', 'bottom-feature-top-pair', 'asymmetric-mosaic']) {
    assert.match(html, new RegExp(`value="${mode}"`));
  }
  assert.match(html, /<option value="nine-grid">九宫格<\/option>/);
  for (const id of ['ratio', 'spacing', 'background', 'preview', 'download', 'position-editor']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /手工调整图片位置/);
  assert.match(html, /id="add-images"/);
  assert.match(html, /data-action="remove-image"/);
  assert.match(source, /createCollage/);
  assert.match(source, /schedulePreview/);
  assert.match(source, /inputVersion/);
  assert.match(source, /focalXInput\.addEventListener\('input'/);
  assert.match(source, /previewCanvas\.addEventListener\('wheel'/);
  assert.match(source, /previewCanvas\.addEventListener\('pointerdown'/);
  assert.match(source, /dataset\.action = 'reorder'/);
  assert.match(source, /modeInput\.addEventListener\('change'/);
  assert.match(source, /URL\.createObjectURL/);
  assert.match(html, /download="collage\.png"/);
});

test('页面完全独立，不使用 iframe、共享通道或自动跳转', async () => {
  const sources = await Promise.all([
    read('index.html'),
    read('src/app.mjs'),
    read('src/renderer.mjs'),
    read('src/layout.mjs'),
  ]);
  const combined = sources.join('\n');
  assert.doesNotMatch(combined, /<iframe|MessageChannel|postMessage|attachCollageChannel|location\.(?:assign|replace)|window\.location\s*=/i);
});

test('页面使用统一简洁顶部导航并标记当前多图拼接工具', async () => {
  const html = await read('index.html');
  assert.match(html, /<nav[^>]*aria-label="图片工具导航"/);
  for (const [label, href] of requiredNav) {
    assert.match(html, new RegExp(`href="${href}"[^>]*>[\\s\\S]*?${label}`));
  }
  assert.match(html, /aria-current="page"[^>]*>[\s\S]*?多图拼接/);
});

test('页面准确说明本地处理、匿名统计和 Apache 2.0 许可证', async () => {
  const html = await read('index.html');
  assert.match(html, /图片仅在浏览器本地处理/);
  assert.match(html, /不会上传图片/);
  assert.match(html, /匿名访问统计/);
  assert.match(html, /不包含图片内容、文件名或永久标识/);
  assert.match(html, /GoogleChromeLabs/);
  assert.match(html, /Apache 2\.0/);
  assert.match(html, /不提供任何担保/);
  assert.match(html, /href="\.\.\/LICENSE"/);
});

test('独立构建脚本会将页面复制到 /collage/ 且不依赖主应用状态', async () => {
  const buildScript = await read('build.mjs');
  assert.match(buildScript, /build\/collage/);
  assert.match(buildScript, /source.*index\.html[\s\S]*destination.*index\.html/);
  assert.doesNotMatch(buildScript, /src\/client|src\/features|rollup/);
});

test('完整构建会发布根 Apache 许可证供拼图相对链接访问', async () => {
  const packageJson = JSON.parse(await read('../package.json'));
  assert.match(packageJson.scripts.build, /build:license/);
  assert.ok(packageJson.scripts['build:license']);

  const html = await read('index.html');
  assert.match(html, /href="\.\.\/LICENSE"/);
});
