import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('simple workspace exposes compression, removal and collage actions', async () => {
  const source = await read('src/client/initial-app/App/index.tsx');
  for (const text of ['图片压缩与处理','图片压缩','智能抠图','多图拼接','选择图片','选择多张图片']) assert.ok(source.includes(text), text);
  assert.match(source, /WorkspaceImage/);
  assert.match(source, /currentFile/);
  assert.match(source, /history/);
});

test('workspace keeps the existing Squoosh compression component', async () => {
  const source = await read('src/client/initial-app/App/index.tsx');
  assert.match(source, /import\('client\/lazy-app\/Compress'\)/);
  assert.match(source, /<Compress/);
  assert.match(source, /onUseResult=/);
});

test('collage includes grid and long-image modes with bounded output', async () => {
  const [component, layout] = await Promise.all([
    read('src/client/workspace/Collage.tsx'), read('src/client/workspace/collage.ts'),
  ]);
  for (const mode of ['grid','vertical','horizontal']) assert.ok(component.includes(mode));
  for (const ratio of ['1:1','4:3','3:4','16:9','9:16']) assert.ok(component.includes(ratio));
  assert.match(layout, /MAX_OUTPUT = 12000/);
  assert.match(component, /加入工作区/);
});

test('background removal is loaded on demand and discloses model size', async () => {
  const source = await read('src/client/workspace/BackgroundRemoval.tsx');
  assert.match(source, /import\('@imgly\/background-removal'\)/);
  assert.match(source, /首次使用需要下载约 54MB/);
  assert.match(source, /模型已缓存/);
  assert.match(source, /加入拼图/);
});

test('new shell removes old animation, demo and long marketing sections from static HTML', async () => {
  const [source, cacheManifest, page] = await Promise.all([
    read('src/client/initial-app/App/index.tsx'),
    read('src/sw/to-cache.ts'),
    read('src/static-build/pages/index/index.tsx'),
  ]);
  for (const old of ['blobCanvas','试试这些示例','小图被压缩']) assert.ok(!source.includes(old));
  assert.doesNotMatch(cacheManifest, /Intro\/blob-anim|blobAnim/);
  assert.doesNotMatch(page, /<Intro/);
  assert.doesNotMatch(page, /shared\/prerendered-app\/Intro/);
  assert.match(page, /正在打开图片工作区/);
});
