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
import { allSrc } from 'client-bundle:client/initial-app';
import favicon from 'url:static-build/assets/favicon.ico';
import ogImage from 'url:static-build/assets/icon-large-maskable.png';
import { escapeStyleScriptContent, siteOrigin } from 'static-build/utils';
import snackbarCss from 'css:../../../shared/custom-els/snack-bar/styles.css';
import * as snackbarStyle from '../../../shared/custom-els/snack-bar/styles.css';

interface Props {}

const Index: FunctionalComponent<Props> = () => (
  <html lang="zh-CN" data-i41-site="imgzip">
    <head>
      <script src="https://stats.i41.cn/analytics.js" async />
      <title>图片压缩与处理 - 本地压缩、抠图和拼图</title>
      <meta
        name="description"
        content="在浏览器本地完成图片压缩、智能抠图和多图拼接，图片无需上传业务服务器。"
      />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:site" content="@SquooshApp" />
      <meta property="og:title" content="在线图片压缩工具 - Squoosh" />
      <meta property="og:type" content="website" />
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
        name="og:description"
        content="Squoosh 是一款免费的在线图片压缩与格式转换工具，可在浏览器本地压缩、对比并导出 JPG、PNG、WebP、AVIF 等格式。"
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
      <link rel="canonical" href={siteOrigin} />
      <style
        dangerouslySetInnerHTML={{ __html: escapeStyleScriptContent(baseCss) }}
      />

    </head>
    <body>
      <div id="app">
        <div style="display:grid;place-items:center;min-height:100vh;font:16px system-ui;color:#667085">
          正在打开图片工作区…
        </div>
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
