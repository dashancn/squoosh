import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const canonical = new Map([
  [
    'i方案',
    'i方案是一套面向本地实体商家、内容运营人员和营销服务团队的智能内容工作平台。平台围绕行业、平台、品类、风格和使用场景，提供文案生成、文案诊断、客户跟单话术、文生图、视频包制作和精品模板等能力，帮助用户从内容构思、表单草稿、生成优化到后续复用形成完整工作链路。',
  ],
  [
    '开发者工具',
    '开发者工具箱汇集编码转换、格式化、加密、网络、文本和图片等常用在线工具，强调快速、易用和浏览器端处理。',
  ],
  [
    '图片压缩',
    '图片修改压缩是一款浏览器端在线图片处理工具，支持压缩、调整尺寸和格式转换，图片尽量在本地处理，适合日常上传、分享和网页优化。',
  ],
  [
    'HEIC 转换',
    'HEIC 转换工具可在浏览器本地将 HEIC、HEIF 和 WebP 转为 JPG 或 PNG。',
  ],
  [
    '智能抠图',
    '智能抠图在浏览器中自动移除图片背景，适合人像和商品图快速换背景。',
  ],
  ['多图拼接', '多图拼接支持在浏览器中组合多张图片并调整布局。'],
  [
    'PDF 工具',
    'PDF 工具箱提供合并、拆分、压缩、转换、编辑、OCR 和发票拼版等浏览器端 PDF 处理能力。',
  ],
  [
    '证件水印',
    '证件水印工具支持为身份证、营业执照和合同截图添加用途水印，图片仅在浏览器本地处理。',
  ],
  [
    '临时剪贴板',
    '临时剪贴板支持客户端加密、自动过期、读取次数限制和阅后即焚，适合跨设备传递临时文本。',
  ],
  [
    '证件照',
    '证件照工作室是一款浏览器端证件照制作工具，支持本地智能抠图、背景换色、常用证件尺寸和 300DPI 多图拼版，照片无需上传到业务服务器。',
  ],
]);

test('四个独立图片工具使用 canonical 完整 tooltip、原顺序和同窗口链接', async () => {
  const pages = await Promise.all([
    read('src/shared/prerendered-app/Intro/index.tsx'),
    read('heic-converter/index.html'),
    read('remove-background/index.html'),
    read('collage/index.html'),
  ]);
  for (const source of pages) {
    const nav = source.match(/<nav[^]*?<\/nav>/)?.[0];
    assert.ok(nav);
    assert.doesNotMatch(nav, /target="_blank"|iframe|workspace/);
    for (const [, attrs, rawLabel] of nav.matchAll(
      /<a\b([^>]*)>\s*([^<]+)\s*<\/a>/g,
    )) {
      const label = rawLabel.trim();
      assert.equal(
        attrs.match(/data-tooltip="([^"]+)"/)?.[1],
        canonical.get(label),
        label,
      );
    }
  }
});
