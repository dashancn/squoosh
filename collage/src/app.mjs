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
const previewCanvas = document.querySelector('#preview-canvas');
const composition = document.querySelector('#composition');
const cellOverlay = document.querySelector('#cell-overlay');
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
let transforms = [];
let selectedIndex = 0;
let previewTimer;
let inputVersion = 0;
let generationVersion = 0;
let currentLayout;
let pointerState;
let reorderState;

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const freshTransform = () => ({ zoom: 1, x: 0.5, y: 0.5 });

function setModeState() {
  const preservesRatio = modeInput.value === 'vertical' || modeInput.value === 'horizontal';
  ratioField.hidden = preservesRatio;
  ratioInput.disabled = preservesRatio;
}

function clearResult() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = undefined;
  preview.removeAttribute('src');
  previewCanvas.width = 0;
  previewCanvas.height = 0;
  cellOverlay.replaceChildren();
  composition.hidden = true;
  currentLayout = undefined;
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
  const transform = transforms[selectedIndex] || freshTransform();
  focalXInput.value = String(Math.round(transform.x * 100));
  focalYInput.value = String(Math.round(transform.y * 100));
  focalXValue.value = `${focalXInput.value}%`;
  focalYValue.value = `${focalYInput.value}%`;
  [...thumbnailList.querySelectorAll('.thumbnail')].forEach((button, index) => {
    button.classList.toggle('selected', index === selectedIndex);
    button.setAttribute('aria-pressed', String(index === selectedIndex));
  });
  [...cellOverlay.querySelectorAll('.preview-cell')].forEach((cell, index) => {
    cell.classList.toggle('selected', index === selectedIndex);
    cell.setAttribute('aria-selected', String(index === selectedIndex));
  });
}

function selectImage(index) {
  if (index < 0 || index >= files.length) return;
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
  fileSummary.textContent = files.length ? `已选择 ${files.length} 张图片，可继续添加或单独移除` : '可一次选择多张 JPG、PNG、WebP 等浏览器支持的图片';
}

function replaceImages(nextFiles) {
  validateFiles(nextFiles);
  files = nextFiles;
  transforms = files.map(freshTransform);
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
  transforms.push(...addedFiles.map(freshTransform));
  renderThumbnails();
  updateFileSummary();
  schedulePreview();
}

function removeImage(index) {
  files.splice(index, 1);
  transforms.splice(index, 1);
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

function reorderImages(from, to) {
  if (from === to || from < 0 || to < 0 || from >= files.length || to >= files.length) return;
  const [file] = files.splice(from, 1);
  const [transform] = transforms.splice(from, 1);
  files.splice(to, 0, file);
  transforms.splice(to, 0, transform);
  selectedIndex = to;
  renderThumbnails();
  schedulePreview();
}

function setSelectedFocal(axis, percent) {
  if (!transforms[selectedIndex]) return;
  transforms[selectedIndex][axis] = clamp01(Number(percent) / 100);
  updateFocalControls();
  schedulePreview();
}

function canvasPoint(event) {
  const rect = previewCanvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * currentLayout.width / rect.width, y: (event.clientY - rect.top) * currentLayout.height / rect.height, rect };
}

function itemAt(point) {
  return currentLayout?.items.findIndex((item) => point.x >= item.x && point.x <= item.x + item.width && point.y >= item.y && point.y <= item.y + item.height) ?? -1;
}

function renderCellOverlay() {
  if (!currentLayout) return;
  cellOverlay.replaceChildren(...currentLayout.items.map((item, index) => {
    const cell = document.createElement('div');
    cell.className = 'preview-cell';
    cell.dataset.index = String(index);
    cell.setAttribute('role', 'option');
    cell.setAttribute('aria-label', `第 ${index + 1} 张图片构图区域`);
    Object.assign(cell.style, { left: `${item.x / currentLayout.width * 100}%`, top: `${item.y / currentLayout.height * 100}%`, width: `${item.width / currentLayout.width * 100}%`, height: `${item.height / currentLayout.height * 100}%` });
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'reorder-handle';
    handle.dataset.action = 'reorder';
    handle.dataset.index = String(index);
    handle.setAttribute('aria-label', `拖动以排序第 ${index + 1} 张图片`);
    handle.textContent = '↕';
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      reorderState = { pointerId: event.pointerId, from: index };
      try { handle.setPointerCapture(event.pointerId); } catch { /* Synthetic test events may not own an active pointer. */ }
      cell.classList.add('reordering');
    });
    handle.addEventListener('pointerup', (event) => {
      if (!reorderState || event.pointerId !== reorderState.pointerId) return;
      const target = itemAt(canvasPoint(event));
      const from = reorderState.from;
      reorderState = undefined;
      cell.classList.remove('reordering');
      reorderImages(from, target);
    });
    handle.addEventListener('pointercancel', () => { reorderState = undefined; cell.classList.remove('reordering'); });
    cell.append(handle);
    return cell;
  }));
  updateFocalControls();
}

filesInput.addEventListener('change', () => { try { const selectedFiles = [...filesInput.files]; if (selectedFiles.length) replaceImages(selectedFiles); } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); filesInput.value = ''; } });
addImagesInput.addEventListener('change', () => { try { appendImages([...addImagesInput.files]); } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); } finally { addImagesInput.value = ''; } });
focalXInput.addEventListener('input', () => setSelectedFocal('x', focalXInput.value));
focalYInput.addEventListener('input', () => setSelectedFocal('y', focalYInput.value));
positionEditor.addEventListener('click', (event) => { const preset = event.target.closest('[data-focal-y]'); if (preset) setSelectedFocal('y', preset.dataset.focalY); });
modeInput.addEventListener('change', () => { setModeState(); schedulePreview(); });
ratioInput.addEventListener('change', schedulePreview);
spacingInput.addEventListener('input', schedulePreview);
backgroundInput.addEventListener('input', schedulePreview);
setModeState();

previewCanvas.addEventListener('wheel', (event) => {
  if (!currentLayout) return;
  event.preventDefault();
  const index = itemAt(canvasPoint(event));
  if (index < 0) return;
  selectImage(index);
  const transform = transforms[index];
  transform.zoom = Math.max(1, Math.min(8, transform.zoom * Math.exp(-event.deltaY * 0.002)));
  schedulePreview();
}, { passive: false });

previewCanvas.addEventListener('pointerdown', (event) => {
  if (!currentLayout || event.button !== 0) return;
  const point = canvasPoint(event);
  const index = itemAt(point);
  if (index < 0) return;
  selectImage(index);
  pointerState = { pointerId: event.pointerId, index, lastX: event.clientX, lastY: event.clientY };
  try { previewCanvas.setPointerCapture(event.pointerId); } catch { /* Synthetic test events may not own an active pointer. */ }
  previewCanvas.classList.add('dragging');
});
previewCanvas.addEventListener('pointermove', (event) => {
  if (!pointerState || event.pointerId !== pointerState.pointerId) return;
  const item = currentLayout.items[pointerState.index];
  const rect = previewCanvas.getBoundingClientRect();
  const transform = transforms[pointerState.index];
  transform.x = clamp01(transform.x - (event.clientX - pointerState.lastX) / (rect.width * item.width / currentLayout.width));
  transform.y = clamp01(transform.y - (event.clientY - pointerState.lastY) / (rect.height * item.height / currentLayout.height));
  pointerState.lastX = event.clientX;
  pointerState.lastY = event.clientY;
  schedulePreview();
});
function endPointer(event) { if (pointerState?.pointerId === event.pointerId) { pointerState = undefined; previewCanvas.classList.remove('dragging'); } }
previewCanvas.addEventListener('pointerup', endPointer);
previewCanvas.addEventListener('pointercancel', endPointer);

async function generatePreview(version) {
  if (!files.length) { status.textContent = '请先选择至少一张图片'; filesInput.focus(); return; }
  const generation = ++generationVersion;
  const requestedFiles = [...files];
  const options = { mode: modeInput.value, ratio: ratioInput.value, spacing: Number(spacingInput.value), background: backgroundInput.value, transforms: transforms.map((transform) => ({ ...transform })) };
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
    await preview.decode();
    previewCanvas.width = result.width;
    previewCanvas.height = result.height;
    previewCanvas.getContext('2d').drawImage(preview, 0, 0);
    currentLayout = result.layout;
    renderCellOverlay();
    composition.hidden = false;
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
  } finally { if (generation === generationVersion) generateButton.disabled = false; }
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
form.addEventListener('submit', (event) => { event.preventDefault(); inputVersion += 1; generationVersion += 1; clearTimeout(previewTimer); generatePreview(inputVersion); });
window.addEventListener('pagehide', () => { clearTimeout(previewTimer); if (previewUrl) URL.revokeObjectURL(previewUrl); thumbnailUrls.forEach((url) => URL.revokeObjectURL(url)); });
