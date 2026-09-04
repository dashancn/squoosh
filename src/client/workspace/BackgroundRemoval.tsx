import { h, Component, createRef } from 'preact';
import * as style from './workspace.css';

const MODEL_CACHE_MARKER = 'imgzip:background-removal-ready:v1';
interface Props { file: File; onBack: () => void; onResult: (file: File, next: 'workspace' | 'collage') => void }
interface State { status: 'missing' | 'cached' | 'loading' | 'ready' | 'error'; progress: number; result?: File; background: string }

async function drawResult(file: File, canvas: HTMLCanvasElement, background: string) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const item = new Image(); item.onload = () => resolve(item); item.onerror = () => reject(new Error('结果读取失败')); item.src = url; });
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d')!; ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (background !== 'transparent') { ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(image, 0, 0);
  } finally { URL.revokeObjectURL(url); }
}

export default class BackgroundRemoval extends Component<Props, State> {
  state: State = { status: localStorage.getItem(MODEL_CACHE_MARKER) === '1' ? 'cached' : 'missing', progress: 0, background: 'transparent' };
  canvas = createRef<HTMLCanvasElement>();
  componentDidUpdate(_: Props, prev: State) { if ((prev.result !== this.state.result || prev.background !== this.state.background) && this.state.result) void drawResult(this.state.result, this.canvas.current!, this.state.background); }

  remove = async () => {
    this.setState({ status: 'loading', progress: 0 });
    try {
      const { removeBackground } = await import('@imgly/background-removal');
      const blob = await removeBackground(this.props.file, {
        publicPath: `${location.origin}/background-removal/1.7.0/`,
        model: 'isnet_quint8',
        device: 'cpu',
        progress: (_key, current, total) => this.setState({ progress: total ? Math.round(current / total * 100) : 0 }),
      });
      const result = new File([blob], this.props.file.name.replace(/\.[^.]+$/, '-透明背景.png'), { type: 'image/png' });
      localStorage.setItem(MODEL_CACHE_MARKER, '1');
      this.setState({ status: 'ready', result, progress: 100 });
    } catch { this.setState({ status: 'error' }); }
  };

  exportFile = async () => {
    if (!this.state.result) return;
    if (this.state.background === 'transparent') return this.state.result;
    const canvas = this.canvas.current!;
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('导出失败')), 'image/png'));
    return new File([blob], this.state.result.name, { type: 'image/png' });
  };

  download = async () => { const file = await this.exportFile(); if (!file) return; const url = URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  pass = async (next: 'workspace' | 'collage') => { const file = await this.exportFile(); if (file) this.props.onResult(file, next); };

  render() { const { status, progress, result, background } = this.state; return <section class={style.toolPage}>
    <header class={style.toolHeader}><button onClick={this.props.onBack}>← 返回工作区</button><div><h2>智能抠图</h2><p>移除背景后可直接加入拼图，不需要重新上传。</p></div></header>
    <div class={style.toolGrid}><aside class={style.panel}>
      <p class={style.notice}>{status === 'cached' || status === 'ready' ? '抠图模型已缓存，可以直接开始处理。' : '首次使用需要下载约 54MB 抠图模型和运行资源，完成后浏览器会缓存。图片不会上传。'}</p>
      <button class={style.primary} disabled={status === 'loading'} onClick={() => void this.remove()}>{status === 'loading' ? `本地抠图 ${progress}%` : result ? '重新抠图' : '开始本地抠图'}</button>
      {status === 'error' && <p class={style.error}>抠图失败，请检查网络后重试。</p>}
      {result && <label>背景<select value={background} onChange={event => this.setState({ background: (event.currentTarget as HTMLSelectElement).value })}><option value="transparent">透明背景</option><option value="#ffffff">白色</option><option value="#438edb">蓝色</option><option value="#d92d35">红色</option></select></label>}
      {result && <div class={style.actions}><button class={style.secondary} onClick={() => void this.pass('workspace')}>保存到工作区</button><button class={style.secondary} onClick={() => void this.pass('collage')}>加入拼图</button><button class={style.primary} onClick={() => void this.download()}>下载 PNG</button></div>}
      <p class={style.note}>基于 @imgly/background-removal，本地处理；代码和模型受其许可证约束。</p>
    </aside><div class={style.preview}>{result ? <canvas ref={this.canvas} /> : <div class={style.empty}>点击“开始本地抠图”后在这里查看结果</div>}</div></div>
  </section>; }
}
