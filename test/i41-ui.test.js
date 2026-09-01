import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('顶部生态导航包含 PDF 工具链接', async () => {
  const source = await read('src/shared/prerendered-app/Intro/index.tsx');
  assert.match(source, /href="https:\/\/pdf\.i41\.cn"/);
  assert.match(source, />\s*PDF 工具\s*</);
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
  const source = await read('src/shared/prerendered-app/Intro/index.tsx');
  const bridge = await read('src/client/lazy-app/sw-bridge/index.ts');
  assert.match(source, /编解码资源已缓存/);
  assert.match(source, /首次使用需要加载编解码资源/);
  assert.match(bridge, /codecCacheStatus/);
});
