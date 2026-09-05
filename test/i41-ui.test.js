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

test('顶部导航使用约定来源链接且不使用下拉生态菜单', async () => {
  const source = await read('src/shared/prerendered-app/Intro/index.tsx');
  assert.ok(source.includes(`href="${iPlanUrl('ecosystem_nav')}"`));
  assert.match(source, />\s*i方案\s*</);
  assert.doesNotMatch(
    source.slice(source.indexOf('<header'), source.indexOf('</header>')),
    /<details|<summary/,
  );
});

test('三个图片工具页面共享完整顶部导航、当前项和本地处理徽章', async () => {
  const [
    compressor,
    removeBackground,
    collage,
    compressorCss,
    removeCss,
    collageCss,
  ] = await Promise.all([
    read('src/shared/prerendered-app/Intro/index.tsx'),
    read('remove-background/index.html'),
    read('collage/index.html'),
    read('src/shared/prerendered-app/Intro/style.css'),
    read('remove-background/src/style.css'),
    read('collage/style.css'),
  ]);
  const pages = [
    [compressor, '图片压缩'],
    [removeBackground, '智能抠图'],
    [collage, '多图拼接'],
  ];
  const navItems = [
    ['i方案', iPlanUrl('ecosystem_nav')],
    ['开发者工具', 'https://tools.i41.cn'],
    ['图片压缩', '/'],
    ['智能抠图', '/remove-background/'],
    ['多图拼接', '/collage/'],
    ['PDF 工具', 'https://pdf.i41.cn'],
    ['证件水印', 'https://watermark.i41.cn'],
    ['临时剪贴板', 'https://clip.i41.cn'],
    ['证件照', 'https://idphoto.i41.cn'],
  ];

  for (const [source, activeLabel] of pages) {
    const header = source.slice(
      source.indexOf('<header'),
      source.indexOf('</header>') + 9,
    );
    assert.doesNotMatch(header, /<details|<summary|生态菜单|i41 生态/);
    assert.match(header, /图片仅在本地处理/);
    assert.match(header, />\s*i方案\s*<\/a>/);
    let previous = -1;
    for (const [label, url] of navItems) {
      const index = header.indexOf(label);
      assert.ok(index > previous, `${label} 应存在且顺序一致`);
      previous = index;
      const encodedUrl = url.replaceAll('&', '&amp;');
      assert.ok(
        header.includes(`href="${url}"`) ||
          header.includes(`href="${encodedUrl}"`),
        `${label} URL 不正确`,
      );
    }
    const activePattern = new RegExp(
      `aria-current="page"[^>]*>\\s*${activeLabel}\\s*<|>\\s*${activeLabel}\\s*<\\/a>[\\s\\S]{0,80}aria-current="page"`,
    );
    assert.match(header, activePattern);
    for (const url of navItems
      .map(([, url]) => url)
      .filter((url) => url.startsWith('https://'))) {
      const href = header.includes(`href="${url}"`)
        ? url
        : url.replaceAll('&', '&amp;');
      const anchor = header.match(
        new RegExp(
          `<a[^>]*href="${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`,
        ),
      )?.[0];
      assert.ok(anchor, `缺少 ${url} 链接`);
      assert.match(anchor, /target="_blank"/);
      assert.match(anchor, /rel="noopener noreferrer"/);
    }
  }

  for (const css of [compressorCss, removeCss, collageCss]) {
    assert.match(css, /\.site-header[\s\S]*height:\s*64px/);
    assert.match(css, /\.header-inner[\s\S]*max-width:\s*1104px/);
    assert.match(css, /\.privacy-badge|\.privacyBadge/);
    assert.match(css, /overflow-x:\s*auto/);
    assert.match(css, /\.i-plan-nav|\.iPlanNav/);
    assert.match(css, /\.i-plan-nav|\.iPlanNav[\s\S]*background:\s*#1769e0/);
  }
});

test('三个页面在导航后、主工具内容前显示同款 i方案横幅', async () => {
  const pages = await Promise.all([
    read('src/shared/prerendered-app/Intro/index.tsx'),
    read('remove-background/index.html'),
    read('collage/index.html'),
  ]);
  for (const source of pages) {
    assert.match(source, /关注 i方案/);
    assert.match(source, /获取内容创作、客户跟单、文生图与视频制作方案/);
    assert.ok(
      source.includes(`href="${iPlanUrl('promo_banner')}"`) ||
        source.includes(
          `href="${iPlanUrl('promo_banner').replaceAll('&', '&amp;')}"`,
        ),
    );
    assert.match(source, /访问 i方案\s*(?:<[^>]+>)*\s*→/);
    assert.ok(source.indexOf('</header>') < source.indexOf('关注 i方案'));
    const toolStart = Math.min(
      ...['class={style.main}', 'class="intro"', 'class="workspace"']
        .map((marker) => source.indexOf(marker))
        .filter((index) => index >= 0),
    );
    assert.ok(
      source.indexOf('关注 i方案') < toolStart,
      '横幅应位于主工具内容前',
    );
  }
});

test('顶部生态导航提供独立智能抠图入口', async () => {
  const source = await read('src/shared/prerendered-app/Intro/index.tsx');
  assert.match(
    source,
    /<a\s+class=\{style\.toolLink\}\s+href="\/remove-background\/">[\s\S]*?智能抠图[\s\S]*?<\/a>/,
  );
});

test('顶部生态导航提供独立多图拼接入口', async () => {
  const source = await read('src/shared/prerendered-app/Intro/index.tsx');
  assert.match(
    source,
    /<a\s+class=\{style\.toolLink\}\s+href="\/collage\/">[\s\S]*?多图拼接[\s\S]*?<\/a>/,
  );
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
    source.indexOf('iPlanBanner') < source.indexOf('main'),
    'i方案引导应位于导航后和主工具区前',
  );
  assert.match(css, /\.i-plan-banner[\s\S]*margin:\s*2rem auto/);
  assert.match(css, /\.i-plan-banner[\s\S]*font-size:\s*1\.15rem/);
  assert.match(css, /\.codec-status[\s\S]*margin:\s*-5rem auto 3rem/);
  assert.match(css, /\.codec-status[\s\S]*font-size:\s*1\.1rem/);
  assert.match(css, /\[data-tooltip\]::after[\s\S]*z-index:\s*5/);
  assert.match(bridge, /codecCacheStatus/);
});
