import { h, Component } from 'preact';

import { linkRef } from 'shared/prerendered-app/util';
import '../../custom-els/loading-spinner';
import logo from 'url:./imgs/logo.svg';
import githubLogo from 'url:./imgs/github-logo.svg';
import largePhoto from 'url:./imgs/demos/demo-large-photo.jpg';
import artwork from 'url:./imgs/demos/demo-artwork.jpg';
import deviceScreen from 'url:./imgs/demos/demo-device-screen.png';
import largePhotoIcon from 'url:./imgs/demos/icon-demo-large-photo.jpg';
import artworkIcon from 'url:./imgs/demos/icon-demo-artwork.jpg';
import deviceScreenIcon from 'url:./imgs/demos/icon-demo-device-screen.jpg';
import smallSectionAsset from 'url:./imgs/info-content/small.svg';
import simpleSectionAsset from 'url:./imgs/info-content/simple.svg';
import secureSectionAsset from 'url:./imgs/info-content/secure.svg';
import logoIcon from 'url:./imgs/demos/icon-demo-logo.png';
import logoWithText from 'data-url-text:./imgs/logo-with-text.svg';
import * as style from './style.css';
import type SnackBarElement from 'shared/custom-els/snack-bar';
import 'shared/custom-els/snack-bar';
import { startBlobs } from './blob-anim/meta';
import SlideOnScroll from './SlideOnScroll';

const demos = [
  {
    description: '大尺寸照片',
    size: '2.8MB',
    filename: 'photo.jpg',
    url: largePhoto,
    iconUrl: largePhotoIcon,
  },
  {
    description: '插画作品',
    size: '2.9MB',
    filename: 'art.jpg',
    url: artwork,
    iconUrl: artworkIcon,
  },
  {
    description: '设备截图',
    size: '1.6MB',
    filename: 'pixel3.png',
    url: deviceScreen,
    iconUrl: deviceScreenIcon,
  },
  {
    description: 'SVG 图标',
    size: '13KB',
    filename: 'squoosh.svg',
    url: logo,
    iconUrl: logoIcon,
  },
] as const;

const blobAnimImport =
  !__PRERENDER__ && matchMedia('(prefers-reduced-motion: reduce)').matches
    ? undefined
    : import('./blob-anim');
const installButtonSource = 'introInstallButton-Purple';
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
  fetchingDemoIndex?: number;
  beforeInstallEvent?: BeforeInstallPromptEvent;
  showBlobSVG: boolean;
}

export default class Intro extends Component<Props, State> {
  state: State = {
    showBlobSVG: true,
  };
  private fileInput?: HTMLInputElement;
  private blobCanvas?: HTMLCanvasElement;
  private installingViaButton = false;

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

  private onDemoClick = async (index: number, event: Event) => {
    try {
      this.setState({ fetchingDemoIndex: index });
      const demo = demos[index];
      const blob = await fetch(demo.url).then((r) => r.blob());
      const file = new File([blob], demo.filename, { type: blob.type });
      this.props.onFile!(file);
    } catch (err) {
      this.setState({ fetchingDemoIndex: undefined });
      this.props.showSnack!('无法加载示例图片');
    }
  };

  private onBeforeInstallPromptEvent = (event: BeforeInstallPromptEvent) => {
    // Don't show the mini-infobar on mobile
    event.preventDefault();

    // Save the beforeinstallprompt event so it can be called later.
    this.setState({ beforeInstallEvent: event });

    // Log the event.
    const gaEventInfo = {
      eventCategory: 'pwa-install',
      eventAction: 'promo-shown',
      nonInteraction: true,
    };
    ga('send', 'event', gaEventInfo);
  };

  private onInstallClick = async (event: Event) => {
    // Get the deferred beforeinstallprompt event
    const beforeInstallEvent = this.state.beforeInstallEvent;
    // If there's no deferred prompt, bail.
    if (!beforeInstallEvent) return;

    this.installingViaButton = true;

    // Show the browser install prompt
    beforeInstallEvent.prompt();

    // Wait for the user to accept or dismiss the install prompt
    const { outcome } = await beforeInstallEvent.userChoice;
    // Send the analytics data
    const gaEventInfo = {
      eventCategory: 'pwa-install',
      eventAction: 'promo-clicked',
      eventLabel: installButtonSource,
      eventValue: outcome === 'accepted' ? 1 : 0,
    };
    ga('send', 'event', gaEventInfo);

    // If the prompt was dismissed, we aren't going to install via the button.
    if (outcome === 'dismissed') {
      this.installingViaButton = false;
    }
  };

  private onAppInstalled = () => {
    // We don't need the install button, if it's shown
    this.setState({ beforeInstallEvent: undefined });

    // Don't log analytics if page is not visible
    if (document.hidden) return;

    // Try to get the install, if it's not set, use 'browser'
    const source = this.installingViaButton ? installButtonSource : 'browser';
    ga('send', 'event', 'pwa-install', 'installed', source);

    // Clear the install method property
    this.installingViaButton = false;
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

  render(
    {}: Props,
    { fetchingDemoIndex, beforeInstallEvent, showBlobSVG }: State,
  ) {
    return (
      <div class={style.intro}>
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
        <div class={style.demosContainer}>
          <aside class={style.iPlanBanner} aria-label="关注 i方案">
            <div>
              <strong>关注 i方案</strong>
              <span>获取内容创作、客户跟单、文生图与视频制作方案</span>
            </div>
            <a
              href="https://www.i41.cn"
              target="_blank"
              rel="noopener noreferrer"
              data-tooltip="i方案是一套面向本地实体商家、内容运营人员和营销服务团队的智能内容工作平台。"
            >
              访问 i方案 <span aria-hidden="true">→</span>
            </a>
          </aside>
          <svg viewBox="0 0 1920 140" class={style.topWave}>
            <path
              d="M1920 0l-107 28c-106 29-320 85-533 93-213 7-427-36-640-50s-427 0-533 7L0 85v171h1920z"
              class={style.subWave}
            />
            <path
              d="M0 129l64-26c64-27 192-81 320-75 128 5 256 69 384 64 128-6 256-80 384-91s256 43 384 70c128 26 256 26 320 26h64v96H0z"
              class={style.mainWave}
            />
          </svg>
          <div class={style.contentPadding}>
            <p class={style.demoTitle}>
              也可以<strong>试试</strong>这些示例：
            </p>
            <ul class={style.demos}>
              {demos.map((demo, i) => (
                <li>
                  <button
                    class="unbutton"
                    onClick={(event) => this.onDemoClick(i, event)}
                  >
                    <div class={style.demoContainer}>
                      <div class={style.demoIconContainer}>
                        <img
                          class={style.demoIcon}
                          src={demo.iconUrl}
                          alt={demo.description}
                        />
                        {fetchingDemoIndex === i && (
                          <div class={style.demoLoader}>
                            <loading-spinner />
                          </div>
                        )}
                      </div>
                      <div class={style.demoSize}>{demo.size}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div class={style.bottomWave}>
          <svg viewBox="0 0 1920 79" class={style.topWave}>
            <path
              d="M0 59l64-11c64-11 192-34 320-43s256-5 384 4 256 23 384 34 256 21 384 14 256-30 320-41l64-11v94H0z"
              class={style.infoWave}
            />
          </svg>
        </div>

        <section class={style.info}>
          <div class={style.infoContainer}>
            <SlideOnScroll>
              <div class={style.infoContent}>
                <div class={style.infoTextWrapper}>
                  <h2 class={style.infoTitle}>更小</h2>
                  <p class={style.infoCaption}>
                    图片越小，网页加载越快。Squoosh
                    可以在尽量保持高画质的同时，显著减小文件体积。
                  </p>
                </div>
                <div class={style.infoImgWrapper}>
                  <img
                    class={style.infoImg}
                    src={smallSectionAsset}
                    alt="一张 1.4MB 大图被压缩成 80KB 小图的示意图"
                    width="536"
                    height="522"
                  />
                </div>
              </div>
            </SlideOnScroll>
          </div>
        </section>

        <section class={style.info}>
          <div class={style.infoContainer}>
            <SlideOnScroll>
              <div class={style.infoContent}>
                <div class={style.infoTextWrapper}>
                  <h2 class={style.infoTitle}>简单</h2>
                  <p class={style.infoCaption}>
                    打开图片，对比压缩前后的效果，然后立即保存。想进一步减小体积？还可以手动调整压缩参数。
                  </p>
                </div>
                <div class={style.infoImgWrapper}>
                  <img
                    class={style.infoImg}
                    src={simpleSectionAsset}
                    alt="展示多种压缩选项和缩小后图片的网格示意图"
                    width="538"
                    height="384"
                  />
                </div>
              </div>
            </SlideOnScroll>
          </div>
        </section>

        <section class={style.info}>
          <div class={style.infoContainer}>
            <SlideOnScroll>
              <div class={style.infoContent}>
                <div class={style.infoTextWrapper}>
                  <h2 class={style.infoTitle}>安全</h2>
                  <p class={style.infoCaption}>
                    担心隐私？图片不会离开你的设备，Squoosh
                    的压缩处理都在浏览器本地完成。
                  </p>
                </div>
                <div class={style.infoImgWrapper}>
                  <img
                    class={style.infoImg}
                    src={secureSectionAsset}
                    alt="带有禁止符号的云朵示意图"
                    width="498"
                    height="333"
                  />
                </div>
              </div>
            </SlideOnScroll>
          </div>
        </section>

        <footer class={style.footer}>
          <div class={style.footerContainer}>
            <svg viewBox="0 0 1920 79" class={style.topWave}>
              <path
                d="M0 59l64-11c64-11 192-34 320-43s256-5 384 4 256 23 384 34 256 21 384 14 256-30 320-41l64-11v94H0z"
                class={style.footerWave}
              />
            </svg>
            <div class={style.footerPadding}>
              <footer class={style.footerItems}>
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
              </footer>
            </div>
          </div>
        </footer>
        <div class={style.headerActions}>
          <a
            class={style.toolLink}
            href="https://tools.i41.cn"
            target="_blank"
            rel="noopener noreferrer"
            data-tooltip="开发者工具箱汇集编码转换、格式化、加密、网络、文本和图片等常用在线工具，强调快速、易用和浏览器端处理。"
          >
            开发者工具
          </a>
          <a
            class={style.toolLink}
            href="https://idphoto.i41.cn"
            target="_blank"
            rel="noopener noreferrer"
            data-tooltip="证件照工作室是一款浏览器端证件照制作工具，支持本地智能抠图、背景换色、常用证件尺寸和 300DPI 多图拼版，照片无需上传到业务服务器。"
          >
            证件照
          </a>
          <a
            class={style.toolLink}
            href="https://pdf.i41.cn"
            target="_blank"
            rel="noopener noreferrer"
            data-tooltip="PDF 工具箱提供合并、拆分、压缩、转换、编辑、OCR 和发票拼版等浏览器端 PDF 处理能力。"
          >
            PDF 工具
          </a>
          {beforeInstallEvent && (
            <button class={style.installBtn} onClick={this.onInstallClick}>
              安装应用
            </button>
          )}
        </div>
      </div>
    );
  }
}
