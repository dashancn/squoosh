/**
 * Copyright 2020 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { h, FunctionalComponent } from 'preact';

import baseCss from 'css:./base.css';
import initialCss from 'initial-css:';
import { allSrc } from 'client-bundle:client/initial-app';
import favicon from 'url:static-build/assets/favicon.ico';
import ogImage from 'url:static-build/assets/icon-large-maskable.png';
import { escapeStyleScriptContent, siteOrigin } from 'static-build/utils';
import Intro from 'shared/prerendered-app/Intro';
import snackbarCss from 'css:../../../shared/custom-els/snack-bar/styles.css';
import * as snackbarStyle from '../../../shared/custom-els/snack-bar/styles.css';

interface Props {}

const description =
  'i41 图片压缩是一款免费的在线图片压缩与格式转换工具，可在浏览器本地压缩、对比并导出 JPG、PNG、WebP、AVIF 等格式。';
const pageTitle = 'i41 图片压缩 - 在线压缩与格式转换';
const pageUrl = `${siteOrigin}/`;
const structuredData = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'i41 图片压缩',
  url: pageUrl,
  description,
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'Any',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
});

const Index: FunctionalComponent<Props> = () => (
  <html lang="zh-CN" data-i41-site="imgzip">
    <head>
      <script src="https://stats.i41.cn/analytics.js" async />
      <title>{pageTitle}</title>
      <meta name="description" content={description} />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content="i41 图片压缩 - 在线压缩与格式转换" />
      <meta
        name="twitter:description"
        content="在浏览器本地压缩、对比并导出 JPG、PNG、WebP、AVIF 等格式。"
      />
      <meta name="twitter:image" content={`${siteOrigin}${ogImage}`} />
      <meta property="og:title" content="i41 图片压缩 - 在线压缩与格式转换" />
      <meta property="og:type" content="website" />
      <meta property="og:url" content={`${siteOrigin}/`} />
      <meta property="og:site_name" content="i41 图片工具" />
      <meta property="og:image" content={`${siteOrigin}${ogImage}`} />
      <meta
        property="og:image:secure_url"
        content={`${siteOrigin}${ogImage}`}
      />
      <meta property="og:image:type" content="image/png" />
      <meta property="og:image:width" content="500" />
      <meta property="og:image:height" content="500" />
      <meta
        property="og:image:alt"
        content="深色背景上，一只手正在压缩图片文件的卡通图标。"
      />
      <meta
        property="og:description"
        content="i41 图片压缩是一款免费的在线图片压缩与格式转换工具，可在浏览器本地压缩、对比并导出 JPG、PNG、WebP、AVIF 等格式。"
      />
      <meta
        name="viewport"
        content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
      />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <link rel="shortcut icon" href={favicon} />
      <link rel="apple-touch-icon" href={ogImage} />
      <meta name="theme-color" content="#ff3385" />
      <link rel="manifest" href="/manifest.json" />
      <link rel="canonical" href={pageUrl} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: escapeStyleScriptContent(structuredData),
        }}
      />
      <style
        dangerouslySetInnerHTML={{ __html: escapeStyleScriptContent(baseCss) }}
      />
      <style
        dangerouslySetInnerHTML={{
          __html: escapeStyleScriptContent(initialCss),
        }}
      />
    </head>
    <body>
      <div id="app">
        <Intro />
        <noscript>
          <style
            dangerouslySetInnerHTML={{
              __html: escapeStyleScriptContent(snackbarCss),
            }}
          />
          <snack-bar>
            <div
              class={snackbarStyle.snackbar}
              aria-live="assertive"
              aria-atomic="true"
              aria-hidden="false"
            >
              <div class={snackbarStyle.text}>
                初始化失败：本站需要启用 JavaScript，但你的浏览器当前已禁用。
              </div>
              <a class={snackbarStyle.button} href="/">
                重新加载
              </a>
            </div>
          </snack-bar>
        </noscript>
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: escapeStyleScriptContent(allSrc),
        }}
      />
    </body>
  </html>
);

export default Index;
