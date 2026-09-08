import { removeBackground } from '@imgly/background-removal';
import { decodeAndValidateRemovalInput } from './input-limits.js';
import {
  normalizeImageFile,
  terminateSharedHeicDecoder,
} from '../../heic-converter/src/input-adapter.mjs';
import {
  applyBrushStamp,
  applyMaskToPixels,
  compositePreviewPixels,
  createMaskHistory,
  interpolateStroke,
  toSourcePoint,
} from './mask-editor.js';

const $ = (selector) => document.querySelector(selector);
const fileInput = $('#file-input');
const dropZone = $('#drop-zone');
const fileName = $('#file-name');
const startButton = $('#start-button');
const downloadButton = $('#download-button');
const status = $('#status');
const progress = $('#progress');
const progressLabel = $('#progress-label');
const backgroundOptions = $('#background-options');
const preview = $('#preview');
const previewEmpty = $('#preview-empty');
const maskControls = $('#mask-editor-controls');
const eraseMode = $('#erase-mode');
const restoreMode = $('#restore-mode');
const brushSize = $('#brush-size');
const brushSizeOutput = $('#brush-size-output');
const undoButton = $('#undo-button');
const redoButton = $('#redo-button');
const resetMaskButton = $('#reset-mask-button');
const context = preview.getContext('2d');
const editCanvas = document.createElement('canvas');
const editContext = editCanvas.getContext('2d');

let selectedFile = null;
let selectedVersion = 0;
let outputBlob = null;
let busy = false;
let sourcePixels = null;
let originalAlpha = null;
let aiMask = null;
let editMask = null;
let maskHistory = null;
let brushMode = 'erase';
let activePointer = null;
let lastPoint = null;
let strokeChanged = false;

function setProgress(value, message) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  progress.value = percent;
  progressLabel.textContent = `${percent}%`;
  if (message) status.textContent = message;
}

async function decodeBlob(blob) {
  const image = new Image();
  const url = URL.createObjectURL(blob);
  image.src = url;
  try {
    await image.decode();
    return await createImageBitmap(blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function bitmapPixels(bitmap) {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const canvasContext = canvas.getContext('2d', { willReadFrequently: true });
  canvasContext.drawImage(bitmap, 0, 0);
  return canvasContext.getImageData(0, 0, canvas.width, canvas.height).data;
}

function selectedBackground() {
  return $('input[name="background"]:checked').value;
}

function updateEditorButtons() {
  undoButton.disabled = !maskHistory?.canUndo();
  redoButton.disabled = !maskHistory?.canRedo();
  resetMaskButton.disabled = !maskHistory;
}

function setBrushMode(mode) {
  brushMode = mode;
  const erasing = mode === 'erase';
  eraseMode.classList.toggle('active', erasing);
  restoreMode.classList.toggle('active', !erasing);
  eraseMode.setAttribute('aria-pressed', String(erasing));
  restoreMode.setAttribute('aria-pressed', String(!erasing));
}

async function renderResult() {
  if (!sourcePixels || !editMask || !editCanvas.width) return;
  const foregroundPixels = applyMaskToPixels(sourcePixels, editMask);
  const backgrounds = {
    transparent: null,
    white: [255, 255, 255],
    blue: [22, 119, 255],
    red: [229, 57, 53],
  };
  const previewPixels = compositePreviewPixels(
    foregroundPixels,
    backgrounds[selectedBackground()],
  );
  editContext.putImageData(
    new ImageData(previewPixels, editCanvas.width, editCanvas.height),
    0,
    0,
  );
  preview.width = editCanvas.width;
  preview.height = editCanvas.height;
  context.clearRect(0, 0, preview.width, preview.height);
  context.drawImage(editCanvas, 0, 0);
  outputBlob = await new Promise((resolve, reject) =>
    preview.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG 导出失败'))),
      'image/png',
    ),
  );
  downloadButton.disabled = false;
  updateEditorButtons();
}

function clearEditor() {
  sourcePixels = null;
  originalAlpha = null;
  aiMask = null;
  editMask = null;
  maskHistory = null;
  activePointer = null;
  lastPoint = null;
  strokeChanged = false;
  maskControls.disabled = true;
  updateEditorButtons();
}

function selectFile(file) {
  selectedVersion += 1;
  selectedFile = file || null;
  outputBlob = null;
  clearEditor();
  backgroundOptions.disabled = true;
  downloadButton.disabled = true;
  startButton.disabled = !selectedFile || busy;
  fileName.textContent = selectedFile
    ? `${selectedFile.name} · ${(selectedFile.size / 1024 / 1024).toFixed(
        2,
      )} MB`
    : '尚未选择图片';
  setProgress(0, selectedFile ? '图片已选择，点击开始抠图' : '等待选择图片');
  previewEmpty.hidden = false;
  context.clearRect(0, 0, preview.width, preview.height);
}

fileInput.addEventListener('change', () => selectFile(fileInput.files?.[0]));
dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('dragging');
});
dropZone.addEventListener('dragleave', () =>
  dropZone.classList.remove('dragging'),
);
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragging');
  selectFile(event.dataTransfer.files?.[0]);
});

startButton.addEventListener('click', async () => {
  if (!selectedFile || busy) return;
  const input = selectedFile;
  const version = selectedVersion;
  busy = true;
  startButton.disabled = true;
  downloadButton.disabled = true;
  backgroundOptions.disabled = true;
  maskControls.disabled = true;
  setProgress(1, '正在准备图片…');
  let sourceBitmap;
  let foregroundBitmap;
  try {
    const inferenceInput = await normalizeImageFile(input);
    if (version !== selectedVersion) return;
    await decodeAndValidateRemovalInput(inferenceInput);
    if (version !== selectedVersion) return;
    const foreground = await removeBackground(inferenceInput, {
      publicPath: new URL('./imgly/', location.href).href,
      model: 'isnet_quint8',
      device: 'cpu',
      proxyToWorker: false,
      output: { format: 'image/png', quality: 1, type: 'foreground' },
      progress: (key, current, total) => {
        if (version !== selectedVersion) return;
        const ratio = total > 0 ? current / total : 0;
        setProgress(Math.min(90, 5 + ratio * 85), `正在本地加载与处理：${key}`);
      },
    });
    if (version !== selectedVersion) return;
    [sourceBitmap, foregroundBitmap] = await Promise.all([
      decodeBlob(inferenceInput),
      decodeBlob(foreground),
    ]);
    if (version !== selectedVersion) return;
    if (
      sourceBitmap.width !== foregroundBitmap.width ||
      sourceBitmap.height !== foregroundBitmap.height
    )
      throw new Error('抠图结果尺寸与原图不一致');
    sourcePixels = bitmapPixels(sourceBitmap);
    originalAlpha = new Uint8ClampedArray(
      sourceBitmap.width * sourceBitmap.height,
    );
    for (let index = 0; index < originalAlpha.length; index += 1)
      originalAlpha[index] = sourcePixels[index * 4 + 3];
    const foregroundPixels = bitmapPixels(foregroundBitmap);
    editCanvas.width = sourceBitmap.width;
    editCanvas.height = sourceBitmap.height;
    aiMask = new Uint8ClampedArray(editCanvas.width * editCanvas.height);
    for (let index = 0; index < aiMask.length; index += 1)
      aiMask[index] = foregroundPixels[index * 4 + 3];
    editMask = new Uint8ClampedArray(aiMask);
    maskHistory = createMaskHistory(aiMask, 20);
    backgroundOptions.disabled = false;
    maskControls.disabled = false;
    previewEmpty.hidden = true;
    await renderResult();
    setProgress(100, '抠图完成，可手工精修、选择背景并下载 PNG');
  } catch (error) {
    if (version === selectedVersion) {
      const detail = error instanceof Error ? error.message : String(error);
      const friendly =
        /Failed to create session|no available backend|dynamically imported module/i.test(
          detail,
        )
          ? '本地抠图运行资源加载失败，请刷新页面后重试；若仍失败，请确认浏览器允许本站脚本与 WebAssembly。'
          : detail;
      setProgress(0, `抠图失败：${friendly}`);
    }
  } finally {
    sourceBitmap?.close?.();
    foregroundBitmap?.close?.();
    if (version === selectedVersion) {
      busy = false;
      startButton.disabled = !selectedFile;
    }
  }
});

function stamp(point) {
  if (!editMask || !sourcePixels) return;
  applyBrushStamp(
    editMask,
    originalAlpha,
    editCanvas.width,
    editCanvas.height,
    point.x,
    point.y,
    Number(brushSize.value) / 2,
    brushMode,
  );
  strokeChanged = true;
}

preview.addEventListener('pointerdown', (event) => {
  if (!editMask || busy) return;
  event.preventDefault();
  activePointer = event.pointerId;
  preview.setPointerCapture(event.pointerId);
  lastPoint = toSourcePoint(
    event.clientX,
    event.clientY,
    preview.getBoundingClientRect(),
    editCanvas.width,
    editCanvas.height,
  );
  strokeChanged = false;
  stamp(lastPoint);
  void renderResult();
});
preview.addEventListener('pointermove', (event) => {
  if (event.pointerId !== activePointer || !lastPoint || !editMask) return;
  event.preventDefault();
  const point = toSourcePoint(
    event.clientX,
    event.clientY,
    preview.getBoundingClientRect(),
    editCanvas.width,
    editCanvas.height,
  );
  for (const sample of interpolateStroke(
    lastPoint,
    point,
    Number(brushSize.value) / 2,
  ))
    stamp(sample);
  lastPoint = point;
  void renderResult();
});
async function finishStroke(event) {
  if (event.pointerId !== activePointer) return;
  activePointer = null;
  lastPoint = null;
  if (strokeChanged && maskHistory) editMask = maskHistory.commit(editMask);
  strokeChanged = false;
  await renderResult();
}
preview.addEventListener('pointerup', finishStroke);
preview.addEventListener('pointercancel', finishStroke);
preview.addEventListener('lostpointercapture', finishStroke);

eraseMode.addEventListener('click', () => setBrushMode('erase'));
restoreMode.addEventListener('click', () => setBrushMode('restore'));
brushSize.addEventListener('input', () => {
  brushSizeOutput.value = `${brushSize.value} px`;
});
undoButton.addEventListener('click', async () => {
  if (!maskHistory?.canUndo()) return;
  editMask = maskHistory.undo();
  await renderResult();
});
redoButton.addEventListener('click', async () => {
  if (!maskHistory?.canRedo()) return;
  editMask = maskHistory.redo();
  await renderResult();
});
resetMaskButton.addEventListener('click', async () => {
  if (!maskHistory) return;
  editMask = maskHistory.reset();
  await renderResult();
});
backgroundOptions.addEventListener('change', () =>
  renderResult().catch((error) => {
    status.textContent = `预览失败：${
      error instanceof Error ? error.message : String(error)
    }`;
  }),
);

downloadButton.addEventListener('click', () => {
  if (!outputBlob) return;
  const link = document.createElement('a');
  const base = selectedFile?.name.replace(/\.[^.]+$/, '') || 'image';
  const url = URL.createObjectURL(outputBlob);
  link.href = url;
  link.download = `${base}-background-removed.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
});

window.addEventListener('pagehide', () => {
  selectedVersion += 1;
  terminateSharedHeicDecoder();
  clearEditor();
});
