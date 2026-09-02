import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('顶部生态导航包含完整 i41 工具链接', async () => {
  const source = await read('src/shared/prerendered-app/Intro/index.tsx');
  for (const [label, url] of [
    ['开发者工具', 'https://tools.i41.cn'],
    ['证件照', 'https://idphoto.i41.cn'],
    ['PDF 工具', 'https://pdf.i41.cn'],
    ['证件水印', 'https://watermark.i41.cn'],
    ['临时剪贴板', 'https://clip.i41.cn'],
    ['访问 i方案', 'https://www.i41.cn'],
  ]) {
    assert.ok(source.includes(`href="${url}"`), `缺少 ${label}`);
    assert.match(source, new RegExp(`>\\s*${label}\\s*<`));
  }
  assert.match(
    source,
    /证件水印工具支持为身份证、营业执照和合同截图添加用途水印/,
  );
  assert.match(source, /客户端加密、自动过期、读取次数限制和阅后即焚/);
});

test('首页使用醒目的 i方案引导卡片', async () => {
  const [source, css] = await Promise.all([
    read('src/shared/prerendered-app/Intro/index.tsx'),
    read('src/shared/prerendered-app/Intro/style.css'),
  ]);
  assert.match(source, /关注 i方案/);
  assert.match(source, /获取内容创作、客户跟单、文生图与视频制作方案/);
  assert.match(source, /访问 i方案/);
  assert.match(css, /\.i-plan-banner/);
});

test('进入编辑器前提示编解码资源缓存状态', async () => {
  const [source, css] = await Promise.all([
    read('src/shared/prerendered-app/Intro/index.tsx'),
    read('src/shared/prerendered-app/Intro/style.css'),
  ]);
  const bridge = await read('src/client/lazy-app/sw-bridge/index.ts');
  assert.match(source, /编解码资源已缓存/);
  assert.match(source, /首次使用需要加载编解码资源/);
  assert.ok(
    source.indexOf('codecStatus') < source.indexOf('demosContainer'),
    '缓存提示应位于透明背景区',
  );
  assert.ok(
    source.indexOf('iPlanBanner') > source.indexOf('demosContainer'),
    'i方案引导应位于蓝色背景区',
  );
  assert.match(css, /\.i-plan-banner[\s\S]*margin:\s*2rem auto/);
  assert.match(css, /\.i-plan-banner[\s\S]*font-size:\s*1\.15rem/);
  assert.match(css, /\.codec-status[\s\S]*margin:\s*-5rem auto 3rem/);
  assert.match(css, /\.codec-status[\s\S]*font-size:\s*1\.1rem/);
  assert.match(css, /\[data-tooltip\]::after[\s\S]*z-index:\s*5/);
  assert.match(bridge, /codecCacheStatus/);
});
