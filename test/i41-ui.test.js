import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const iPlanUrl = (content) =>
  `https://www.i41.cn?utm_source=imgzip&utm_medium=tool_referral&utm_campaign=ifangan&utm_content=${content}`;

const hrefsToIPlan = (source) =>
  [...source.matchAll(/href="(https:\/\/www\.i41\.cn[^"]*)"/g)].map(
    ([, href]) => href,
  );

test('生成页面加载 i41 匿名统计并标记站点', async () => {
  const source = await read('src/static-build/pages/index/index.tsx');
  assert.match(source, /<html lang="zh-CN" data-i41-site="imgzip">/);
  assert.match(
    source,
    /<script src="https:\/\/stats\.i41\.cn\/analytics\.js" async \/>/,
  );
});

test('隐私说明准确描述本地图片处理和匿名统计范围', async () => {
  const readme = await read('README.md');
  assert.match(readme, /图片处理内容.*(?:浏览器)?本地/s);
  assert.match(readme, /匿名访问/);
  assert.match(readme, /UTM/);
  assert.match(readme, /跨站点击/);
  assert.match(readme, /不(?:会|包含).*图片内容/s);
  assert.match(readme, /不(?:会|包含).*文件名/s);
  assert.match(readme, /不(?:会|包含).*永久标识/s);
});

test('移除旧 Google Analytics 及内容尺寸和 PWA 统计调用', async () => {
  const sources = await Promise.all([
    read('src/client/initial-app/index.tsx'),
    read('src/shared/prerendered-app/Intro/index.tsx'),
    read('src/client/lazy-app/Compress/Results/index.tsx'),
  ]);
  const runtime = sources.join('\n');
  assert.doesNotMatch(runtime, /UA-\d+-\d+/);
  assert.doesNotMatch(runtime, /google-analytics\.com/);
  assert.doesNotMatch(runtime, /\bga\s*\(/);
  assert.doesNotMatch(runtime, /metric[123]/);
  assert.doesNotMatch(runtime, /eventCategory:\s*'pwa-install'/);
});

test('顶部生态导航包含完整 i41 工具链接并标记生态导航来源', async () => {
  const source = await read('src/shared/prerendered-app/Intro/index.tsx');
  for (const [label, url] of [
    ['开发者工具', 'https://tools.i41.cn'],
    ['证件照', 'https://idphoto.i41.cn'],
    ['PDF 工具', 'https://pdf.i41.cn'],
    ['证件水印', 'https://watermark.i41.cn'],
    ['临时剪贴板', 'https://clip.i41.cn'],
    ['访问 i方案', iPlanUrl('ecosystem_nav')],
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

test('首页浅黄色促销横幅使用独立 UTM 标记', async () => {
  const [source, css] = await Promise.all([
    read('src/shared/prerendered-app/Intro/index.tsx'),
    read('src/shared/prerendered-app/Intro/style.css'),
  ]);
  assert.match(source, /关注 i方案/);
  assert.match(source, /获取内容创作、客户跟单、文生图与视频制作方案/);
  assert.ok(source.includes(`href="${iPlanUrl('promo_banner')}"`));
  assert.match(css, /\.i-plan-banner/);
});

test('页脚保留上游归属并标记 i方案访问来源', async () => {
  const [source, license, packageJson] = await Promise.all([
    read('src/shared/prerendered-app/Intro/index.tsx'),
    read('LICENSE'),
    read('package.json'),
  ]);
  const footer = source.match(
    /<footer class=\{style\.footer\}>[\s\S]*?<\/footer>/,
  )?.[0];
  assert.ok(footer, '缺少页面页脚');
  assert.ok(footer.includes(`href="${iPlanUrl('footer')}"`));
  assert.match(footer, />\s*访问 i方案\s*</);
  assert.match(footer, /i41\s+免费实用工具/);
  assert.match(footer, /GoogleChromeLabs/);
  assert.match(footer, /Apache 2\.0/);
  assert.match(license, /Apache License[\s\S]*Version 2\.0/);
  assert.equal(JSON.parse(packageJson).license, 'apache-2.0');
});

test('所有 i方案链接均使用约定 UTM 且不宣称 i方案免费', async () => {
  const source = await read('src/shared/prerendered-app/Intro/index.tsx');
  assert.deepEqual(
    hrefsToIPlan(source).sort(),
    [
      iPlanUrl('ecosystem_nav'),
      iPlanUrl('footer'),
      iPlanUrl('promo_banner'),
    ].sort(),
  );
  assert.doesNotMatch(
    source,
    /i方案.{0,12}(?:免费|永久免费)|(?:免费|永久免费).{0,12}i方案/,
  );
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
