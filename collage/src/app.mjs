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
const positionEditor = document.querySelector('#position-editor');
const thumbnailList = document.querySelector('#thumbnail-list');
const focalXInput = document.querySelector('#focal-x');
const focalYInput = document.querySelector('#focal-y');
const focalXValue = document.querySelector('#focal-x-value');
const focalYValue = document.querySelector('#focal-y-value');
let previewUrl;
let thumbnailUrls = [];
let focalPoints = [];
let selectedIndex = 0;

function setModeState() {
  const preservesRatio = modeInput.value === 'vertical' || modeInput.value === 'horizontal';
  ratioField.hidden = preservesRatio;
  ratioInput.disabled = preservesRatio;
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

function updateFocalControls() {
  const focal = focalPoints[selectedIndex] || { x: 0.5, y: 0.5 };
  focalXInput.value = String(Math.round(focal.x * 100));
  focalYInput.value = String(Math.round(focal.y * 100));
  focalXValue.value = `${focalXInput.value}%`;
  focalYValue.value = `${focalYInput.value}%`;
  [...thumbnailList.children].forEach((button, index) => {
    button.classList.toggle('selected', index === selectedIndex);
    button.setAttribute('aria-pressed', String(index === selectedIndex));
  });
}

function selectImage(index) {
  selectedIndex = index;
  updateFocalControls();
}

function renderThumbnails(files) {
  thumbnailUrls.forEach((url) => URL.revokeObjectURL(url));
  thumbnailUrls = files.map((file) => URL.createObjectURL(file));
  thumbnailList.replaceChildren(...files.map((file, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'thumbnail';
    button.setAttribute('role', 'listitem');
    button.setAttribute('aria-label', `调整第 ${index + 1} 张：${file.name}`);
    const image = document.createElement('img');
    image.src = thumbnailUrls[index];
    image.alt = '';
    const number = document.createElement('span');
    number.textContent = String(index + 1);
    button.append(image, number);
    button.addEventListener('click', () => selectImage(index));
    return button;
  }));
  positionEditor.hidden = files.length === 0;
  selectImage(0);
}

function setSelectedFocal(axis, percent) {
  if (!focalPoints[selectedIndex]) return;
  focalPoints[selectedIndex][axis] = Number(percent) / 100;
  clearResult();
  updateFocalControls();
  status.textContent = `第 ${selectedIndex + 1} 张焦点已调整，可重新生成`;
}

filesInput.addEventListener('change', () => {
  clearResult();
  const files = [...filesInput.files];
  focalPoints = files.map(() => ({ x: 0.5, y: 0.5 }));
  renderThumbnails(files);
  fileSummary.textContent = files.length ? `已选择 ${files.length} 张图片` : '可一次选择多张 JPG、PNG、WebP 等浏览器支持的图片';
  status.textContent = files.length ? '可以生成拼图' : '选择图片后生成拼图';
});

focalXInput.addEventListener('input', () => setSelectedFocal('x', focalXInput.value));
focalYInput.addEventListener('input', () => setSelectedFocal('y', focalYInput.value));
positionEditor.addEventListener('click', (event) => {
  const preset = event.target.closest('[data-focal-y]');
  if (preset) setSelectedFocal('y', preset.dataset.focalY);
});
modeInput.addEventListener('change', () => {
  setModeState();
  clearResult();
  status.textContent = filesInput.files.length ? '模板已切换，图片焦点保持不变' : '选择图片后生成拼图';
});
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
      focalPoints,
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
  thumbnailUrls.forEach((url) => URL.revokeObjectURL(url));
});
