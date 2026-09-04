import type { FileDropEvent } from 'file-drop-element';
import type SnackBarElement from 'shared/custom-els/snack-bar';
import type { SnackOptions } from 'shared/custom-els/snack-bar';
import { h, Component } from 'preact';
import { linkRef } from 'shared/prerendered-app/util';
import * as style from 'client/workspace/workspace.css';
import 'add-css:client/workspace/workspace.css';
import 'file-drop-element';
import 'shared/custom-els/snack-bar';
import 'shared/custom-els/loading-spinner';

const CompressPromise = import('client/lazy-app/Compress');
const CollagePromise = import('client/workspace/Collage');
const BackgroundRemovalPromise = import('client/workspace/BackgroundRemoval');
const swBridgePromise = import('client/lazy-app/sw-bridge');

type Tool = 'home' | 'compress' | 'remove' | 'collage';
interface WorkspaceImage { id: string; originalFile: File; currentFile: File; history: File[]; previewUrl: string }
interface Props {}
interface State { awaitingShareTarget: boolean; tool: Tool; images: WorkspaceImage[]; activeId?: string; loadingTool: boolean; Compress?: typeof import('client/lazy-app/Compress').default; Collage?: typeof import('client/workspace/Collage').default; BackgroundRemoval?: typeof import('client/workspace/BackgroundRemoval').default }

function workspaceImage(file: File): WorkspaceImage { return { id: crypto.randomUUID(), originalFile: file, currentFile: file, history: [file], previewUrl: URL.createObjectURL(file) }; }

export default class App extends Component<Props, State> {
  state: State = { awaitingShareTarget: new URL(location.href).searchParams.has('share-target'), tool: 'home', images: [], loadingTool: false };
  snackbar?: SnackBarElement;

  constructor() {
    super();
    CompressPromise.then(module => this.setState({ Compress: module.default }));
    swBridgePromise.then(async ({ offliner, getSharedImage }) => { offliner(this.showSnack); if (!this.state.awaitingShareTarget) return; this.addFiles([await getSharedImage()]); history.replaceState('', '', '/'); this.setState({ awaitingShareTarget: false }); });
  }
  componentWillUnmount() { this.state.images.forEach(image => URL.revokeObjectURL(image.previewUrl)); }

  private showSnack = (message: string, options: SnackOptions = {}) => { if (!this.snackbar) throw Error('Snackbar missing'); return this.snackbar.showSnackbar(message, options); };
  private addFiles = (files: File[]) => { const accepted = files.filter(file => file.type.startsWith('image/')).slice(0, Math.max(0, 20 - this.state.images.length)); if (!accepted.length) return; const additions = accepted.map(workspaceImage); this.setState(state => ({ images: [...state.images, ...additions], activeId: state.activeId || additions[0].id })); };
  private onFileDrop = ({ files }: FileDropEvent) => { if (files) this.addFiles([...files]); };
  private selected = () => this.state.images.find(image => image.id === this.state.activeId) || this.state.images[0];
  private updateCurrent = (file: File, id = this.state.activeId) => { if (!id) return; this.setState(state => ({ images: state.images.map(image => image.id === id ? (URL.revokeObjectURL(image.previewUrl), { ...image, currentFile: file, history: [...image.history, file], previewUrl: URL.createObjectURL(file) }) : image) })); };
  private removeImage = (id: string) => this.setState(state => { const item = state.images.find(image => image.id === id); if (item) URL.revokeObjectURL(item.previewUrl); const images = state.images.filter(image => image.id !== id); return { images, activeId: state.activeId === id ? images[0]?.id : state.activeId }; });
  private openTool = async (tool: Tool) => { if (tool !== 'home' && !this.state.images.length) { this.showSnack('请先选择图片'); return; } this.setState({ loadingTool: true }); if (tool === 'collage' && !this.state.Collage) this.setState({ Collage: (await CollagePromise).default }); if (tool === 'remove' && !this.state.BackgroundRemoval) this.setState({ BackgroundRemoval: (await BackgroundRemovalPromise).default }); this.setState({ tool, loadingTool: false }); };

  renderHome() {
    const selected = this.selected();
    return <div class={style.shell}><header class={style.topbar}><strong class={style.brand}>图片压缩与处理</strong><nav class={style.nav}><a href="https://www.i41.cn?utm_source=imgzip&utm_medium=tool_referral&utm_campaign=ifangan&utm_content=ecosystem_nav" target="_blank" rel="noopener noreferrer">i方案</a><a href="https://tools.i41.cn" target="_blank" rel="noopener noreferrer">开发者工具</a><a href="https://pdf.i41.cn" target="_blank" rel="noopener noreferrer">PDF 工具</a><a href="https://idphoto.i41.cn" target="_blank" rel="noopener noreferrer">证件照</a><a href="https://watermark.i41.cn" target="_blank" rel="noopener noreferrer">证件水印</a><a href="https://clip.i41.cn" target="_blank" rel="noopener noreferrer">临时剪贴板</a></nav></header>
      <main class={style.main}><section class={style.hero}><h1>图片压缩与处理</h1><p>选择图片后，按需压缩、抠图或拼接。所有图片只在浏览器本地处理。</p><span class={style.privacy}>无需注册 · 不上传业务服务器 · 最多 20 张</span><div class={style.picker}><label>选择图片<input type="file" accept="image/*" onChange={event => this.addFiles([...(event.currentTarget as HTMLInputElement).files || []])} /></label><label class={style.secondary}>选择多张图片<input type="file" accept="image/*" multiple onChange={event => this.addFiles([...(event.currentTarget as HTMLInputElement).files || []])} /></label></div></section>
        <section class={style.cards}><button class={style.card} onClick={() => void this.openTool('compress')}><strong>图片压缩</strong><p>使用 Squoosh 内核减小体积、调整尺寸和转换格式。</p></button><button class={style.card} onClick={() => void this.openTool('remove')}><strong>智能抠图</strong><p>移除背景，导出透明 PNG，结果可直接加入拼图。</p></button><button class={style.card} onClick={() => void this.openTool('collage')}><strong>多图拼接</strong><p>制作宫格图、纵向长图和横向拼图。</p></button></section>
        <section class={style.workspace}>{this.state.images.length ? [<aside class={style.panel}><strong>工作区图片（{this.state.images.length}）</strong><div class={style.images}>{this.state.images.map(image => <div class={style.imageRow} onClick={() => this.setState({ activeId: image.id })}><img src={image.previewUrl} alt="" /><span>{image.currentFile.name}</span><button aria-label="移除" onClick={event => { event.stopPropagation(); this.removeImage(image.id); }}>×</button></div>)}</div></aside>,<div class={style.preview}>{selected ? <div><img src={selected.previewUrl} alt={selected.currentFile.name} style="max-width:100%;max-height:420px" /><div class={style.steps}><button class={style.primary} onClick={() => void this.openTool('compress')}>去压缩</button><button class={style.secondary} onClick={() => void this.openTool('remove')}>去抠图</button><button class={style.secondary} onClick={() => void this.openTool('collage')}>去拼图</button></div></div> : null}</div>] : <div class={style.empty}>先选择一张或多张图片<br />之后无需重复上传，可连续处理</div>}</section>
      </main><footer class={style.footer}>图片压缩 · i41 免费实用工具 · 浏览器本地处理 · AGPL-3.0-only<details><summary>查看隐私与开源说明</summary><p>图片和编辑参数不会发送到统计服务。本项目由 dashancn 修改并整合，整体采用 AGPL-3.0-only，任何人可按该许可证传播和修改；本软件不提供任何担保。</p><p>压缩基于 GoogleChromeLabs Squoosh（Apache 2.0）；智能抠图基于 IMG.LY 组件及其许可证。</p><p><a href="https://github.com/dashancn/squoosh" target="_blank" rel="noopener noreferrer">查看源码</a> · <a href="https://github.com/dashancn/squoosh/blob/dev/IMG_LY_THIRD_PARTY_LICENSES.md" target="_blank" rel="noopener noreferrer">IMG.LY 与第三方许可证</a></p></details></footer><snack-bar ref={linkRef(this, 'snackbar')} /></div>;
  }

  render() {
    const { tool, Compress, Collage, BackgroundRemoval, loadingTool } = this.state; const selected = this.selected();
    if (loadingTool || this.state.awaitingShareTarget) return <loading-spinner class={style.empty} />;
    if (tool === 'compress' && selected && Compress) return <Compress file={selected.currentFile} showSnack={this.showSnack} onBack={() => this.setState({ tool: 'home' })} onUseResult={file => { this.updateCurrent(file, selected.id); this.setState({ tool: 'home' }); }} />;
    if (tool === 'remove' && selected && BackgroundRemoval) return <BackgroundRemoval file={selected.currentFile} onBack={() => this.setState({ tool: 'home' })} onResult={async (file, next) => { this.updateCurrent(file, selected.id); if (next === 'collage' && !this.state.Collage) this.setState({ Collage: (await CollagePromise).default }); this.setState({ tool: next === 'collage' ? 'collage' : 'home' }); }} />;
    if (tool === 'collage' && Collage) return <Collage files={this.state.images.map(image => image.currentFile)} onBack={() => this.setState({ tool: 'home' })} onAddResult={file => { this.addFiles([file]); this.setState({ tool: 'home' }); }} />;
    return <file-drop onfiledrop={this.onFileDrop} class={style.shell}>{this.renderHome()}</file-drop>;
  }
}
