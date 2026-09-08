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

test('抠图结果提供触控友好的蒙版精修控制且导出使用编辑结果', async () => {
  const [html, source, style] = await Promise.all([
    read('remove-background/index.html'),
    read('remove-background/src/main.js'),
    read('remove-background/src/style.css'),
  ]);
  for (const id of [
    'mask-editor-controls',
    'erase-mode',
    'restore-mode',
    'brush-size',
    'brush-size-output',
    'undo-button',
    'redo-button',
    'reset-mask-button',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(
    html,
    /aria-pressed="true"[^>]*>擦除|id="erase-mode"[^>]*aria-pressed="true"/,
  );
  assert.match(html, /恢复/);
  assert.match(source, /pointerdown/);
  assert.match(source, /pointermove/);
  assert.match(source, /setPointerCapture/);
  assert.match(source, /containedImageRect/);
  assert.match(source, /toContainedSourcePoint/);
  assert.match(source, /interpolateStroke/);
  assert.match(source, /createMaskHistory/);
  assert.match(source, /createRenderOwnership/);
  assert.match(style, /#preview[^}]*touch-action:\s*none/s);
  assert.match(style, /min-height:\s*44px/);
  assert.match(style, /:focus-visible/);
  assert.match(style, /@media \(max-width:\s*760px\)/);
  assert.match(html, /黑边外涂抹不会修改图片/);
  assert.match(style, /button:focus-visible/);
  assert.match(style, /\.brush-control input[^}]*min-height:\s*44px/s);
  assert.match(style, /overflow-x:\s*hidden/);
});

test('移动笔划只刷新低分辨率脏区，完整导出由提交操作触发', async () => {
  const source = await read('remove-background/src/main.js');
  const move = source.match(
    /preview\.addEventListener\('pointermove',[\s\S]*?\n}\);/,
  )?.[0];
  assert.ok(move, '缺少 pointermove 处理器');
  assert.doesNotMatch(
    move,
    /toBlob|exportResult|applyMaskToPixels|new ImageData/,
  );
  assert.match(move, /updatePreviewBounds/);
  assert.match(source, /finishStroke[\s\S]*exportResult/);
  assert.match(source, /createRenderOwnership/);
  assert.match(source, /releasePointerCapture/);
  assert.match(source, /isPrimaryPointerStart/);
});

test('处理中切换文件可重新开始，黑边中断笔划且历史按笔划记录', async () => {
  const source = await read('remove-background/src/main.js');
  assert.match(source, /function selectFile[\s\S]*busy = false/);
  assert.match(source, /if \(!point\) \{[\s\S]*lastPoint = null/);
  assert.match(source, /strokeRecorder/);
  assert.match(source, /commitEntry/);
  assert.doesNotMatch(source, /maskHistory\?\.commit\(editMask\)/);
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

test('调用抠图模型前会校验编码大小并安全解码检查尺寸', async () => {
  const source = await read('remove-background/src/main.js');
  assert.match(source, /decodeAndValidateRemovalInput\(inferenceInput\)/);
  assert.ok(
    source.indexOf('decodeAndValidateRemovalInput(inferenceInput)') <
      source.indexOf('removeBackground(inferenceInput'),
    '输入限制必须在 removeBackground 前执行',
  );
});

test('抠图直接接收 HEIC/HEIF，并在推理前转成同名 PNG', async () => {
  const [html, source] = await Promise.all([
    read('remove-background/index.html'),
    read('remove-background/src/main.js'),
  ]);
  assert.match(html, /accept="[^\"]*\.heic[^\"]*\.heif/);
  assert.match(source, /normalizeImageFile\(input/);
  assert.ok(
    source.indexOf('normalizeImageFile(input') <
      source.indexOf('removeBackground('),
    'HEIC 必须在推理前规范化为 PNG',
  );
  assert.match(source, /inferenceInput/);
});

test('抠图拖放入口直接接受 HEIC/HEIF 并复用选择逻辑', async () => {
  const [html, source] = await Promise.all([
    read('remove-background/index.html'),
    read('remove-background/src/main.js'),
  ]);
  assert.match(html, /id="drop-zone"/);
  assert.match(source, /dropZone\.addEventListener\('drop'/);
  assert.match(source, /selectFile\(event\.dataTransfer\.files\?\.\[0\]/);
});

test('全站 CSP 允许抠图所需的 blob 模块与 WASM，同时避免重复策略', async () => {
  const [page, config] = await Promise.all([
    read('src/static-build/index.tsx'),
    read('remove-background/vite.config.js'),
  ]);
  assert.match(
    page,
    /script-src 'self' blob: 'wasm-unsafe-eval' 'unsafe-eval'/,
  );
  assert.match(page, /worker-src 'self' blob:/);
  assert.doesNotMatch(page, /Cross-Origin-Embedder-Policy/);
  assert.doesNotMatch(
    config,
    /write-remove-background-headers|\/remove-background\/\*/,
  );
});

test('生产构建接入 /remove-background/ 且保留独立入口', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  assert.match(packageJson.scripts.build, /build:remove-background/);
  assert.ok(packageJson.scripts['build:remove-background']);
  const config = await read('remove-background/vite.config.js');
  assert.match(config, /build\/remove-background/);
});

test('抠图生产构建包含 AGPL 许可证并提供本站精确源代码链接', async () => {
  const html = await read('remove-background/index.html');
  assert.match(html, /href="\.\/LICENSE-AGPL\.md"/);
  assert.match(html, /github\.com\/dashancn\/squoosh\/tree\/__SOURCE_COMMIT__/);
  assert.match(html, /本站修改后的完整源代码/);

  const config = await read('remove-background/vite.config.js');
  assert.match(config, /LICENSE-AGPL\.md/);
  assert.match(config, /writeBundle/);
  assert.match(config, /transformIndexHtml/);
});
