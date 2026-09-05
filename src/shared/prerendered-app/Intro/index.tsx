import { h, Component } from 'preact';

import { linkRef } from 'shared/prerendered-app/util';
import githubLogo from 'url:./imgs/github-logo.svg';
import logoWithText from 'data-url-text:./imgs/logo-with-text.svg';
import * as style from './style.css';
import type SnackBarElement from 'shared/custom-els/snack-bar';
import 'shared/custom-els/snack-bar';
import { startBlobs } from './blob-anim/meta';

const blobAnimImport =
  !__PRERENDER__ && matchMedia('(prefers-reduced-motion: reduce)').matches
    ? undefined
    : import('./blob-anim');
const supportsClipboardAPI =
  !__PRERENDER__ && navigator.clipboard && navigator.clipboard.read;

async function getImageClipboardItem(
  items: ClipboardItem[],
): Promise<undefined | Blob> {
  for (const item of items) {
    const type = item.types.find((type) => type.startsWith('image/'));
    if (type) return item.getType(type);
  }
}

interface Props {
  onFile?: (file: File) => void;
  showSnack?: SnackBarElement['showSnackbar'];
}
interface State {
  beforeInstallEvent?: BeforeInstallPromptEvent;
  showBlobSVG: boolean;
}

export default class Intro extends Component<Props, State> {
  state: State = {
    showBlobSVG: true,
  };
  private fileInput?: HTMLInputElement;
  private blobCanvas?: HTMLCanvasElement;

  componentDidMount() {
    const codecsCached = localStorage.getItem('squoosh-codecs-cached') === '1';
    document
      .querySelectorAll('[data-codec-status]')
      .forEach((element) =>
        element.setAttribute(
          'data-codec-status',
          codecsCached ? 'cached' : 'missing',
        ),
      );

    // Listen for beforeinstallprompt events, indicating Squoosh is installable.
    window.addEventListener(
      'beforeinstallprompt',
      this.onBeforeInstallPromptEvent,
    );

    // Listen for the appinstalled event, indicating Squoosh has been installed.
    window.addEventListener('appinstalled', this.onAppInstalled);

    if (blobAnimImport) {
      blobAnimImport.then((module) => {
        this.setState(
          {
            showBlobSVG: false,
          },
          () => module.startBlobAnim(this.blobCanvas!),
        );
      });
    }
  }

  componentWillUnmount() {
    window.removeEventListener(
      'beforeinstallprompt',
      this.onBeforeInstallPromptEvent,
    );
    window.removeEventListener('appinstalled', this.onAppInstalled);
  }

  private onFileChange = (event: Event): void => {
    const fileInput = event.target as HTMLInputElement;
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    this.fileInput!.value = '';
    this.props.onFile!(file);
  };

  private onOpenClick = () => {
    this.fileInput!.click();
  };

  private onBeforeInstallPromptEvent = (event: BeforeInstallPromptEvent) => {
    // Don't show the mini-infobar on mobile
    event.preventDefault();

    // Save the beforeinstallprompt event so it can be called later.
    this.setState({ beforeInstallEvent: event });
  };

  private onInstallClick = async () => {
    // Get the deferred beforeinstallprompt event
    const beforeInstallEvent = this.state.beforeInstallEvent;
    // If there's no deferred prompt, bail.
    if (!beforeInstallEvent) return;

    // Show the browser install prompt
    beforeInstallEvent.prompt();

    // Wait for the user to accept or dismiss the install prompt
    await beforeInstallEvent.userChoice;
  };

  private onAppInstalled = () => {
    // We don't need the install button, if it's shown
    this.setState({ beforeInstallEvent: undefined });
  };

  private onPasteClick = async () => {
    let clipboardItems: ClipboardItem[];

    try {
      clipboardItems = await navigator.clipboard.read();
    } catch (err) {
      this.props.showSnack!(`没有权限访问剪贴板`);
      return;
    }

    const blob = await getImageClipboardItem(clipboardItems);

    if (!blob) {
      this.props.showSnack!(`剪贴板中没有找到图片`);
      return;
    }

    this.props.onFile!(new File([blob], 'image.unknown'));
  };

  render({}: Props, { beforeInstallEvent, showBlobSVG }: State) {
    return (
      <div class={style.intro}>
        <header class={style.siteHeader}>
          <div class={style.headerInner}>
            <a class={style.brand} href="/" aria-label="i41 图片压缩首页">
              <span aria-hidden="true">图</span>
              i41 图片压缩
            </a>
            <nav class={style.toolNav} aria-label="图片工具导航">
              <a
                class={`${style.toolLink} ${style.iPlanNav}`}
                href="https://www.i41.cn?utm_source=imgzip&utm_medium=tool_referral&utm_campaign=ifangan&utm_content=ecosystem_nav"
                data-tooltip="了解内容创作与业务增长方案"
              >
                i方案
              </a>
              <a
                class={style.toolLink}
                href="https://tools.i41.cn"
                data-tooltip="使用编码、格式化等开发工具"
              >
                开发者工具
              </a>
              <a
                class={style.toolLink}
                href="/remove-background/"
                data-tooltip="在本地移除图片背景"
              >
                智能抠图
              </a>
              <a
                class={style.toolLink}
                href="/collage/"
                data-tooltip="将多张图片拼成宫格或长图"
              >
                多图拼接
              </a>
              <a
                class={style.toolLink}
                href="https://pdf.i41.cn"
                data-tooltip="处理、转换和整理 PDF 文件"
              >
                PDF 工具
              </a>
              <a
                class={style.toolLink}
                href="https://watermark.i41.cn"
                data-tooltip="为证件图片添加安全水印"
              >
                证件水印
              </a>
              <a
                class={style.toolLink}
                href="https://clip.i41.cn"
                data-tooltip="临时保存和分享文本内容"
              >
                临时剪贴板
              </a>
              <a
                class={style.toolLink}
                href="https://idphoto.i41.cn"
                data-tooltip="制作规范尺寸的证件照片"
              >
                证件照
              </a>
            </nav>
            {beforeInstallEvent && (
              <button class={style.installBtn} onClick={this.onInstallClick}>
                安装应用
              </button>
            )}
          </div>
        </header>
        <aside class={style.iPlanBanner} aria-label="关注 i方案">
          <div>
            <strong>关注 i方案</strong>
            <span>获取内容创作、客户跟单、文生图与视频制作方案</span>
          </div>
          <a href="https://www.i41.cn?utm_source=imgzip&utm_medium=tool_referral&utm_campaign=ifangan&utm_content=promo_banner">
            访问 i方案 <span aria-hidden="true">→</span>
          </a>
        </aside>
        <input
          class={style.hide}
          ref={linkRef(this, 'fileInput')}
          type="file"
          onChange={this.onFileChange}
        />
        <div class={style.main}>
          {!__PRERENDER__ && (
            <canvas
              ref={linkRef(this, 'blobCanvas')}
              class={style.blobCanvas}
            />
          )}
          <h1 class={style.logoContainer}>
            <img
              class={style.logo}
              src={logoWithText}
              alt="Squoosh"
              width="539"
              height="162"
            />
          </h1>
          <div class={style.loadImg}>
            {showBlobSVG && (
              <svg
                class={style.blobSvg}
                viewBox="-1.25 -1.25 2.5 2.5"
                preserveAspectRatio="xMidYMid slice"
              >
                {startBlobs.map((points) => (
                  <path
                    d={points
                      .map((point, i) => {
                        const nextI = i === points.length - 1 ? 0 : i + 1;
                        let d = '';
                        if (i === 0) {
                          d += `M${point[2]} ${point[3]}`;
                        }
                        return (
                          d +
                          `C${point[4]} ${point[5]} ${points[nextI][0]} ${points[nextI][1]} ${points[nextI][2]} ${points[nextI][3]}`
                        );
                      })
                      .join('')}
                  />
                ))}
              </svg>
            )}
            <div
              class={style.loadImgContent}
              style={{ visibility: __PRERENDER__ ? 'hidden' : '' }}
            >
              <button class={style.loadBtn} onClick={this.onOpenClick}>
                <svg viewBox="0 0 24 24" class={style.loadIcon}>
                  <path d="M19 7v3h-2V7h-3V5h3V2h2v3h3v2h-3zm-3 4V8h-3V5H5a2 2 0 00-2 2v12c0 1.1.9 2 2 2h12a2 2 0 002-2v-8h-3zM5 19l3-4 2 3 3-4 4 5H5z" />
                </svg>
              </button>
              <div>
                <span class={style.dropText}>拖拽图片到这里</span> 或{' '}
                {supportsClipboardAPI ? (
                  <button class={style.pasteBtn} onClick={this.onPasteClick}>
                    粘贴
                  </button>
                ) : (
                  '粘贴'
                )}
              </div>
            </div>
          </div>
        </div>
        <p class={style.codecStatus} data-codec-status="missing">
          <span class={style.codecStatusMissing}>
            首次使用需要加载编解码资源，加载完成后浏览器会缓存。
          </span>
          <span class={style.codecStatusCached}>
            编解码资源已缓存，可以直接开始图片处理。
          </span>
        </p>
        <section class={style.compactBenefits} aria-label="图片压缩特点">
          <div>
            <h2>更小</h2>
            <p>在尽量保持画质的同时减小文件体积。</p>
          </div>
          <div>
            <h2>简单</h2>
            <p>打开图片、对比效果、调整参数并保存。</p>
          </div>
          <div>
            <h2>本地处理</h2>
            <p>压缩在浏览器本地完成，图片不会离开你的设备。</p>
          </div>
        </section>

        <footer class={style.footer}>
          <div class={style.footerContainer}>
            <div class={style.footerPadding}>
              <p class={style.footerTagline}>i41 免费实用工具</p>
              <details class={style.footerDetails}>
                <summary>隐私、许可与开源说明</summary>
                <div class={style.footerItems}>
                  <a
                    class={style.footerLink}
                    href="https://github.com/GoogleChromeLabs/squoosh/blob/dev/README.md#privacy"
                  >
                    隐私说明
                  </a>
                  <a
                    class={style.footerLinkWithLogo}
                    href="https://github.com/GoogleChromeLabs/squoosh"
                  >
                    <img src={githubLogo} alt="" width="10" height="10" />
                    GitHub 源码
                  </a>
                  <span>
                    基于 GoogleChromeLabs Squoosh（Apache 2.0），不提供任何担保
                  </span>
                  <a
                    class={style.footerLink}
                    href="https://www.i41.cn?utm_source=imgzip&utm_medium=tool_referral&utm_campaign=ifangan&utm_content=footer"
                  >
                    访问 i方案
                  </a>
                </div>
              </details>
            </div>
          </div>
        </footer>
      </div>
    );
  }
}
