import { createCollage } from './renderer.mjs';

const form = document.querySelector('#controls');
const filesInput = document.querySelector('#files');
const fileSummary = document.querySelector('#file-summary');
const modeInput = document.querySelector('#mode');
const ratioField = document.querySelector('#ratio-field');
const ratioInput = document.querySelector('#ratio');
const spacingInput = document.querySelector('#spacing');
const backgroundInput = document.querySelector('#background');
const generateButton = document.querySelector('#generate');
const status = document.querySelector('#status');
const preview = document.querySelector('#preview');
const emptyPreview = document.querySelector('#empty-preview');
const download = document.querySelector('#download');
let previewUrl;

function setModeState() {
  const isGrid = modeInput.value === 'grid';
  ratioField.hidden = !isGrid;
  ratioInput.disabled = !isGrid;
}

function clearResult() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = undefined;
  preview.removeAttribute('src');
  download.removeAttribute('href');
  download.hidden = true;
  emptyPreview.hidden = false;
  document.documentElement.dataset.state = 'idle';
}

filesInput.addEventListener('change', () => {
  clearResult();
  const count = filesInput.files.length;
  fileSummary.textContent = count ? `已选择 ${count} 张图片` : '可一次选择多张 JPG、PNG、WebP 等浏览器支持的图片';
  status.textContent = count ? '可以生成拼图' : '选择图片后生成拼图';
});

modeInput.addEventListener('change', setModeState);
setModeState();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const files = [...filesInput.files];
  if (!files.length) {
    status.textContent = '请先选择至少一张图片';
    filesInput.focus();
    return;
  }

  generateButton.disabled = true;
  status.textContent = `正在处理 ${files.length} 张图片…`;
  document.documentElement.dataset.state = 'working';

  try {
    const result = await createCollage(files, {
      mode: modeInput.value,
      ratio: ratioInput.value,
      spacing: Number(spacingInput.value),
      background: backgroundInput.value,
    });
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(result.blob);
    preview.src = previewUrl;
    emptyPreview.hidden = true;
    download.href = previewUrl;
    download.hidden = false;
    status.textContent = `已生成 ${result.width} × ${result.height} PNG（${result.blob.size.toLocaleString()} 字节）`;
    document.documentElement.dataset.state = 'complete';
  } catch (error) {
    clearResult();
    status.textContent = `拼图失败：${error instanceof Error ? error.message : String(error)}`;
    document.documentElement.dataset.state = 'error';
  } finally {
    generateButton.disabled = false;
  }
});

window.addEventListener('pagehide', () => {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
});
