import { h, Component, createRef } from 'preact';
import { calculateCollageLayout, CollageMode, CollageRatio } from './collage';
import * as style from './workspace.css';

interface Props { files: File[]; onBack: () => void; onAddResult: (file: File) => void }
interface State { mode: CollageMode; ratio: CollageRatio; gap: number; background: string }

async function imageFromFile(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error('图片读取失败');
  }
}

function drawCover(ctx: CanvasRenderingContext2D, image: ImageBitmap, x: number, y: number, width: number, height: number) {
  const scale = Math.max(width / image.width, height / image.height);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.width - sourceWidth) / 2;
  const sourceY = (image.height - sourceHeight) / 2;
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

export default class Collage extends Component<Props, State> {
  state: State = { mode: 'grid', ratio: '1:1', gap: 12, background: '#ffffff' };
  canvas = createRef<HTMLCanvasElement>();

  componentDidMount() { void this.renderCanvas(); }
  componentDidUpdate(prev: Props, prevState: State) {
    if (
      prev.files !== this.props.files ||
      prevState.mode !== this.state.mode ||
      prevState.ratio !== this.state.ratio ||
      prevState.gap !== this.state.gap ||
      prevState.background !== this.state.background
    ) void this.renderCanvas();
  }

  renderCanvas = async () => {
    if (!this.canvas.current || !this.props.files.length) return;
    const images = await Promise.all(this.props.files.map(imageFromFile));
    try {
      const layout = calculateCollageLayout(images.map(image => ({ width: image.width, height: image.height })), this.state.mode, { gap: this.state.gap, ratio: this.state.ratio });
      const canvas = this.canvas.current;
      canvas.width = layout.width; canvas.height = layout.height;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = this.state.background; ctx.fillRect(0, 0, canvas.width, canvas.height);
      layout.cells.forEach(cell => drawCover(ctx, images[cell.imageIndex], cell.x, cell.y, cell.width, cell.height));
    } finally {
      images.forEach(image => image.close());
    }
  };

  save = async (addToWorkspace: boolean) => {
    const canvas = this.canvas.current!;
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('导出失败')), 'image/png'));
    const file = new File([blob], `拼图-${Date.now()}.png`, { type: 'image/png' });
    if (addToWorkspace) this.props.onAddResult(file);
    else { const url = URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  };

  render() {
    return <section class={style.toolPage}>
      <header class={style.toolHeader}><button onClick={this.props.onBack}>← 返回工作区</button><div><h2>多图拼接</h2><p>选择模板即可生成，适合朋友圈、商品图和长图。</p></div></header>
      <div class={style.toolGrid}><aside class={style.panel}>
        <label>拼图方式<select value={this.state.mode} onChange={event => this.setState({ mode: (event.currentTarget as HTMLSelectElement).value as CollageMode })}><option value="grid">宫格拼图</option><option value="vertical">纵向长图</option><option value="horizontal">横向拼接</option></select></label>
        {this.state.mode === 'grid' && <label>画布比例<select value={this.state.ratio} onChange={event => this.setState({ ratio: (event.currentTarget as HTMLSelectElement).value as CollageRatio })}><option value="auto">自动</option><option value="1:1">1:1</option><option value="4:3">4:3</option><option value="3:4">3:4</option><option value="16:9">16:9</option><option value="9:16">9:16</option></select></label>}
        <label>图片间距 <output>{this.state.gap}px</output><input type="range" min="0" max="60" value={this.state.gap} onInput={event => this.setState({ gap: Number((event.currentTarget as HTMLInputElement).value) })} /></label>
        <label>背景颜色<input type="color" value={this.state.background} onInput={event => this.setState({ background: (event.currentTarget as HTMLInputElement).value })} /></label>
        <p class={style.note}>已选择 {this.props.files.length} 张图片。输出最长边限制为 12000px，避免浏览器内存过高。</p>
        <div class={style.actions}><button class={style.secondary} onClick={() => void this.save(true)}>加入工作区</button><button class={style.primary} onClick={() => void this.save(false)}>下载拼图</button></div>
      </aside><div class={style.preview}><canvas ref={this.canvas} /></div></div>
    </section>;
  }
}
