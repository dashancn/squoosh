import { createCollage } from './renderer.mjs';
import { validateFiles } from './limits.mjs';

const form = document.querySelector('#controls');
const filesInput = document.querySelector('#files');
const addImagesInput = document.querySelector('#add-images');
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
const thumbnailTemplate = document.querySelector('#image-thumbnail-template');
const focalXInput = document.querySelector('#focal-x');
const focalYInput = document.querySelector('#focal-y');
const focalXValue = document.querySelector('#focal-x-value');
const focalYValue = document.querySelector('#focal-y-value');
let previewUrl;
let thumbnailUrls = [];
let files = [];
let focalPoints = [];
let selectedIndex = 0;
let previewTimer;
let inputVersion = 0;
let generationVersion = 0;

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

function invalidateDownload() {
  download.removeAttribute('href');
  download.hidden = true;
}

function updateFocalControls() {
  const focal = focalPoints[selectedIndex] || { x: 0.5, y: 0.5 };
  focalXInput.value = String(Math.round(focal.x * 100));
  focalYInput.value = String(Math.round(focal.y * 100));
  focalXValue.value = `${focalXInput.value}%`;
  focalYValue.value = `${focalYInput.value}%`;
  [...thumbnailList.querySelectorAll('.thumbnail')].forEach((button, index) => {
    button.classList.toggle('selected', index === selectedIndex);
    button.setAttribute('aria-pressed', String(index === selectedIndex));
  });
}

function selectImage(index) {
  selectedIndex = index;
  updateFocalControls();
}

function renderThumbnails() {
  thumbnailUrls.forEach((url) => URL.revokeObjectURL(url));
  thumbnailUrls = files.map((file) => URL.createObjectURL(file));
  thumbnailList.replaceChildren(...files.map((file, index) => {
    const item = thumbnailTemplate.content.firstElementChild.cloneNode(true);
    const button = item.querySelector('.thumbnail');
    const removeButton = item.querySelector('[data-action="remove-image"]');
    button.setAttribute('aria-label', `调整第 ${index + 1} 张：${file.name}`);
    const image = document.createElement('img');
    image.src = thumbnailUrls[index];
    image.alt = '';
    const number = document.createElement('span');
    number.textContent = String(index + 1);
    button.append(image, number);
    button.addEventListener('click', () => selectImage(index));
    removeButton.setAttribute('aria-label', `移除第 ${index + 1} 张：${file.name}`);
    removeButton.addEventListener('click', () => removeImage(index));
    return item;
  }));
  positionEditor.hidden = files.length === 0;
  if (files.length) selectImage(Math.min(selectedIndex, files.length - 1));
}

function updateFileSummary() {
  fileSummary.textContent = files.length
    ? `已选择 ${files.length} 张图片，可继续添加或单独移除`
    : '可一次选择多张 JPG、PNG、WebP 等浏览器支持的图片';
}

function replaceImages(nextFiles) {
  validateFiles(nextFiles);
  files = nextFiles;
  focalPoints = files.map(() => ({ x: 0.5, y: 0.5 }));
  selectedIndex = 0;
  renderThumbnails();
  updateFileSummary();
  schedulePreview();
}

function appendImages(addedFiles) {
  if (!addedFiles.length) return;
  const nextFiles = [...files, ...addedFiles];
  validateFiles(nextFiles);
  files = nextFiles;
  focalPoints.push(...addedFiles.map(() => ({ x: 0.5, y: 0.5 })));
  renderThumbnails();
  updateFileSummary();
  schedulePreview();
}

function removeImage(index) {
  files.splice(index, 1);
  focalPoints.splice(index, 1);
  selectedIndex = Math.min(selectedIndex, Math.max(0, files.length - 1));
  renderThumbnails();
  updateFileSummary();
  if (files.length) schedulePreview();
  else {
    inputVersion += 1;
    generationVersion += 1;
    clearTimeout(previewTimer);
    clearResult();
    status.textContent = '选择图片后自动生成拼图';
  }
}

function setSelectedFocal(axis, percent) {
  if (!focalPoints[selectedIndex]) return;
  focalPoints[selectedIndex][axis] = Number(percent) / 100;
  updateFocalControls();
  schedulePreview();
}

filesInput.addEventListener('change', () => {
  try {
    const selectedFiles = [...filesInput.files];
    if (selectedFiles.length) replaceImages(selectedFiles);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    filesInput.value = '';
  }
});

addImagesInput.addEventListener('change', () => {
  try {
    appendImages([...addImagesInput.files]);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    addImagesInput.value = '';
  }
});

focalXInput.addEventListener('input', () => setSelectedFocal('x', focalXInput.value));
focalYInput.addEventListener('input', () => setSelectedFocal('y', focalYInput.value));
positionEditor.addEventListener('click', (event) => {
  const preset = event.target.closest('[data-focal-y]');
  if (preset) setSelectedFocal('y', preset.dataset.focalY);
});
modeInput.addEventListener('change', () => {
  setModeState();
  schedulePreview();
});
ratioInput.addEventListener('change', schedulePreview);
spacingInput.addEventListener('input', schedulePreview);
backgroundInput.addEventListener('input', schedulePreview);
setModeState();

async function generatePreview(version) {
  if (!files.length) {
    status.textContent = '请先选择至少一张图片';
    filesInput.focus();
    return;
  }
  const generation = ++generationVersion;
  const requestedFiles = [...files];
  const options = {
    mode: modeInput.value,
    ratio: ratioInput.value,
    spacing: Number(spacingInput.value),
    background: backgroundInput.value,
    focalPoints: focalPoints.map((point) => ({ ...point })),
  };
  generateButton.disabled = true;
  invalidateDownload();
  status.textContent = `正在处理 ${requestedFiles.length} 张图片…`;
  document.documentElement.dataset.state = 'working';
  try {
    const result = await createCollage(requestedFiles, options);
    if (version !== inputVersion || generation !== generationVersion) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(result.blob);
    preview.src = previewUrl;
    emptyPreview.hidden = true;
    download.href = previewUrl;
    download.hidden = false;
    status.textContent = `已生成 ${result.width} × ${result.height} PNG（${result.blob.size.toLocaleString()} 字节）`;
    document.documentElement.dataset.state = 'complete';
  } catch (error) {
    if (version !== inputVersion || generation !== generationVersion) return;
    clearResult();
    status.textContent = `拼图失败：${error instanceof Error ? error.message : String(error)}`;
    document.documentElement.dataset.state = 'error';
  } finally {
    if (generation === generationVersion) generateButton.disabled = false;
  }
}

function schedulePreview() {
  inputVersion += 1;
  generationVersion += 1;
  clearTimeout(previewTimer);
  invalidateDownload();
  if (!files.length) return;
  const version = inputVersion;
  status.textContent = '正在更新预览…';
  previewTimer = setTimeout(() => generatePreview(version), 120);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  inputVersion += 1;
  generationVersion += 1;
  clearTimeout(previewTimer);
  generatePreview(inputVersion);
});

window.addEventListener('pagehide', () => {
  clearTimeout(previewTimer);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  thumbnailUrls.forEach((url) => URL.revokeObjectURL(url));
});
