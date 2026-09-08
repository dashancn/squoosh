import { removeBackground } from '@imgly/background-removal';
import { decodeAndValidateRemovalInput } from './input-limits.js';
import {
  normalizeImageFile,
  terminateSharedHeicDecoder,
} from '../../heic-converter/src/input-adapter.mjs';
import {
  applyBrushStamp,
  containedImageRect,
  createMaskHistory,
  createRenderOwnership,
  interpolateStroke,
  isPrimaryPointerStart,
  mergeBounds,
  toContainedSourcePoint,
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
const previewContext = preview.getContext('2d', { willReadFrequently: true });
const exportCanvas = document.createElement('canvas');
const exportContext = exportCanvas.getContext('2d');
const renderOwnership = createRenderOwnership();
const backgrounds = {
  transparent: null,
  white: [255, 255, 255],
  blue: [22, 119, 255],
  red: [229, 57, 53],
};
const MAX_PREVIEW_EDGE = 1200;

let selectedFile = null;
let selectedVersion = 0;
let busy = false;
let sourceWidth = 0;
let sourceHeight = 0;
let sourcePixels = null;
let originalAlpha = null;
let editMask = null;
let maskHistory = null;
let previewSource = null;
let previewImage = null;
let brushMode = 'erase';
let activePointer = null;
let lastPoint = null;
let strokeChanged = false;
let strokeBounds = null;
let strokeRecorder = null;
let exportQueue = Promise.resolve();

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

function pixelsFromBitmap(bitmap) {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const canvasContext = canvas.getContext('2d', { willReadFrequently: true });
  if (!canvasContext) throw new Error('浏览器无法创建图片画布');
  canvasContext.drawImage(bitmap, 0, 0);
  const pixels = canvasContext.getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  ).data;
  canvas.width = 0;
  canvas.height = 0;
  return pixels;
}

function alphaFromBitmap(bitmap) {
  const pixels = pixelsFromBitmap(bitmap);
  const alpha = new Uint8ClampedArray(bitmap.width * bitmap.height);
  for (let index = 0; index < alpha.length; index += 1)
    alpha[index] = pixels[index * 4 + 3];
  pixels.fill(0);
  return alpha;
}

function selectedBackground() {
  return $('input[name="background"]:checked').value;
}

function updateEditorButtons() {
  undoButton.disabled = !maskHistory?.canUndo();
  redoButton.disabled = !maskHistory?.canRedo();
  resetMaskButton.disabled = !maskHistory;
  downloadButton.disabled =
    !renderOwnership.outputBlob || renderOwnership.pending;
}

function setBrushMode(mode) {
  brushMode = mode;
  const erasing = mode === 'erase';
  eraseMode.classList.toggle('active', erasing);
  restoreMode.classList.toggle('active', !erasing);
  eraseMode.setAttribute('aria-pressed', String(erasing));
  restoreMode.setAttribute('aria-pressed', String(!erasing));
}

function makePreview(bitmap) {
  const scale = Math.min(
    1,
    MAX_PREVIEW_EDGE / Math.max(bitmap.width, bitmap.height),
  );
  preview.width = Math.max(1, Math.round(bitmap.width * scale));
  preview.height = Math.max(1, Math.round(bitmap.height * scale));
  previewContext.clearRect(0, 0, preview.width, preview.height);
  previewContext.drawImage(bitmap, 0, 0, preview.width, preview.height);
  previewSource = previewContext.getImageData(
    0,
    0,
    preview.width,
    preview.height,
  ).data;
  previewImage = previewContext.createImageData(preview.width, preview.height);
}

function updatePreviewBounds(bounds = null) {
  if (
    !previewSource ||
    !previewImage ||
    !editMask ||
    !sourceWidth ||
    !sourceHeight
  )
    return;
  const background = backgrounds[selectedBackground()];
  const scaleX = sourceWidth / preview.width;
  const scaleY = sourceHeight / preview.height;
  let left = 0;
  let top = 0;
  let right = preview.width - 1;
  let bottom = preview.height - 1;
  if (bounds) {
    left = Math.max(0, Math.floor(bounds.left / scaleX) - 1);
    top = Math.max(0, Math.floor(bounds.top / scaleY) - 1);
    right = Math.min(preview.width - 1, Math.ceil(bounds.right / scaleX) + 1);
    bottom = Math.min(
      preview.height - 1,
      Math.ceil(bounds.bottom / scaleY) + 1,
    );
  }
  for (let y = top; y <= bottom; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y + 0.5) * scaleY));
    for (let x = left; x <= right; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x + 0.5) * scaleX));
      const sourceIndex = sourceY * sourceWidth + sourceX;
      const pixelIndex = (y * preview.width + x) * 4;
      const alpha = Math.min(originalAlpha[sourceIndex], editMask[sourceIndex]);
      if (!background) {
        previewImage.data[pixelIndex] = previewSource[pixelIndex];
        previewImage.data[pixelIndex + 1] = previewSource[pixelIndex + 1];
        previewImage.data[pixelIndex + 2] = previewSource[pixelIndex + 2];
        previewImage.data[pixelIndex + 3] = alpha;
      } else {
        const amount = alpha / 255;
        previewImage.data[pixelIndex] = Math.round(
          previewSource[pixelIndex] * amount + background[0] * (1 - amount),
        );
        previewImage.data[pixelIndex + 1] = Math.round(
          previewSource[pixelIndex + 1] * amount + background[1] * (1 - amount),
        );
        previewImage.data[pixelIndex + 2] = Math.round(
          previewSource[pixelIndex + 2] * amount + background[2] * (1 - amount),
        );
        previewImage.data[pixelIndex + 3] = 255;
      }
    }
  }
  previewContext.putImageData(
    previewImage,
    0,
    0,
    left,
    top,
    right - left + 1,
    bottom - top + 1,
  );
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG 导出失败'))),
      'image/png',
    ),
  );
}

function exportResult() {
  if (!sourcePixels || !editMask || !sourceWidth || !sourceHeight) return;
  const backgroundName = selectedBackground();
  const token = renderOwnership.request(backgroundName);
  downloadButton.disabled = true;
  exportQueue = exportQueue
    .catch(() => {})
    .then(async () => {
      if (!renderOwnership.isCurrent(token)) return;
      const background = backgrounds[backgroundName];
      try {
        const output = new Uint8ClampedArray(sourcePixels.length);
        for (let index = 0; index < editMask.length; index += 1) {
          const pixelIndex = index * 4;
          const alpha = Math.min(sourcePixels[pixelIndex + 3], editMask[index]);
          if (!background) {
            output[pixelIndex] = sourcePixels[pixelIndex];
            output[pixelIndex + 1] = sourcePixels[pixelIndex + 1];
            output[pixelIndex + 2] = sourcePixels[pixelIndex + 2];
            output[pixelIndex + 3] = alpha;
          } else {
            const amount = alpha / 255;
            output[pixelIndex] = Math.round(
              sourcePixels[pixelIndex] * amount + background[0] * (1 - amount),
            );
            output[pixelIndex + 1] = Math.round(
              sourcePixels[pixelIndex + 1] * amount +
                background[1] * (1 - amount),
            );
            output[pixelIndex + 2] = Math.round(
              sourcePixels[pixelIndex + 2] * amount +
                background[2] * (1 - amount),
            );
            output[pixelIndex + 3] = 255;
          }
        }
        if (!renderOwnership.isCurrent(token)) return;
        exportCanvas.width = sourceWidth;
        exportCanvas.height = sourceHeight;
        exportContext.putImageData(
          new ImageData(output, sourceWidth, sourceHeight),
          0,
          0,
        );
        const blob = await canvasToBlob(exportCanvas);
        if (renderOwnership.publish(token, blob))
          downloadButton.disabled = false;
      } catch (error) {
        if (renderOwnership.fail(token)) {
          downloadButton.disabled = true;
          throw error;
        }
      } finally {
        updateEditorButtons();
      }
    });
  return exportQueue;
}

async function runExport() {
  try {
    await exportResult();
    return true;
  } catch (error) {
    status.textContent = `导出失败：${
      error instanceof Error ? error.message : String(error)
    }`;
    return false;
  }
}

function releaseActivePointer() {
  if (activePointer !== null) {
    try {
      if (preview.hasPointerCapture(activePointer))
        preview.releasePointerCapture(activePointer);
    } catch {
      // Capture may already have been released by the browser.
    }
  }
  activePointer = null;
  lastPoint = null;
  strokeChanged = false;
  strokeBounds = null;
  strokeRecorder = null;
}

function clearEditor() {
  releaseActivePointer();
  renderOwnership.select(selectedVersion);
  sourcePixels?.fill(0);
  originalAlpha?.fill(0);
  editMask?.fill(0);
  previewSource?.fill(0);
  previewImage?.data.fill(0);
  maskHistory?.clear?.();
  sourcePixels = null;
  originalAlpha = null;
  editMask = null;
  maskHistory = null;
  previewSource = null;
  previewImage = null;
  sourceWidth = 0;
  sourceHeight = 0;
  preview.width = 0;
  preview.height = 0;
  exportCanvas.width = 0;
  exportCanvas.height = 0;
  maskControls.disabled = true;
  updateEditorButtons();
}

function selectFile(file) {
  selectedVersion += 1;
  selectedFile = file || null;
  clearEditor();
  busy = false;
  backgroundOptions.disabled = true;
  startButton.disabled = !selectedFile;
  fileName.textContent = selectedFile
    ? `${selectedFile.name} · ${(selectedFile.size / 1024 / 1024).toFixed(
        2,
      )} MB`
    : '尚未选择图片';
  setProgress(0, selectedFile ? '图片已选择，点击开始抠图' : '等待选择图片');
  previewEmpty.hidden = false;
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
    sourceWidth = sourceBitmap.width;
    sourceHeight = sourceBitmap.height;
    sourcePixels = pixelsFromBitmap(sourceBitmap);
    originalAlpha = new Uint8ClampedArray(sourceWidth * sourceHeight);
    for (let index = 0; index < originalAlpha.length; index += 1)
      originalAlpha[index] = sourcePixels[index * 4 + 3];
    editMask = alphaFromBitmap(foregroundBitmap);
    maskHistory = createMaskHistory(editMask, 20);
    renderOwnership.select(version);
    makePreview(sourceBitmap);
    updatePreviewBounds();
    backgroundOptions.disabled = false;
    maskControls.disabled = false;
    previewEmpty.hidden = true;
    await exportResult();
    if (version === selectedVersion)
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

function eventSourcePoint(event) {
  return toContainedSourcePoint(
    event.clientX,
    event.clientY,
    containedImageRect(
      preview.getBoundingClientRect(),
      preview.width,
      preview.height,
    ),
    sourceWidth,
    sourceHeight,
  );
}

function stamp(point) {
  if (!point || !editMask || !originalAlpha) return null;
  const result = applyBrushStamp(
    editMask,
    originalAlpha,
    sourceWidth,
    sourceHeight,
    point.x,
    point.y,
    Number(brushSize.value) / 2,
    brushMode,
    (index, before) => {
      if (strokeRecorder && !strokeRecorder.has(index))
        strokeRecorder.set(index, before);
    },
  );
  if (result.changed) {
    if (!strokeChanged) {
      renderOwnership.reviseMask();
      downloadButton.disabled = true;
    }
    strokeChanged = true;
    strokeBounds = mergeBounds(strokeBounds, result.bounds);
  }
  return result.bounds;
}

preview.addEventListener('pointerdown', (event) => {
  if (!editMask || busy || !isPrimaryPointerStart(event, activePointer)) return;
  const point = eventSourcePoint(event);
  if (!point) return;
  event.preventDefault();
  activePointer = event.pointerId;
  preview.setPointerCapture(event.pointerId);
  lastPoint = point;
  strokeChanged = false;
  strokeBounds = null;
  strokeRecorder = new Map();
  const bounds = stamp(point);
  if (bounds) updatePreviewBounds(bounds);
});

preview.addEventListener('pointermove', (event) => {
  if (event.pointerId !== activePointer || !editMask) return;
  const point = eventSourcePoint(event);
  if (!point) {
    lastPoint = null;
    return;
  }
  event.preventDefault();
  let changedBounds = null;
  const samples = lastPoint
    ? interpolateStroke(lastPoint, point, Number(brushSize.value) / 2)
    : [point];
  for (const sample of samples)
    changedBounds = mergeBounds(changedBounds, stamp(sample));
  lastPoint = point;
  if (changedBounds) updatePreviewBounds(changedBounds);
});

async function finishStroke(event) {
  if (event.pointerId !== activePointer) return;
  try {
    if (preview.hasPointerCapture(event.pointerId))
      preview.releasePointerCapture(event.pointerId);
  } catch {
    // lostpointercapture can arrive after automatic release.
  }
  activePointer = null;
  lastPoint = null;
  const indices = strokeRecorder
    ? Uint32Array.from(strokeRecorder.keys())
    : new Uint32Array();
  const before = new Uint8ClampedArray(indices.length);
  const after = new Uint8ClampedArray(indices.length);
  for (let index = 0; index < indices.length; index += 1) {
    before[index] = strokeRecorder.get(indices[index]);
    after[index] = editMask[indices[index]];
  }
  const changed =
    strokeChanged && maskHistory?.commitEntry({ indices, before, after });
  strokeChanged = false;
  strokeBounds = null;
  strokeRecorder = null;
  if (changed) {
    updateEditorButtons();
    await runExport();
  }
  updateEditorButtons();
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
  renderOwnership.reviseMask();
  updatePreviewBounds();
  updateEditorButtons();
  await runExport();
});
redoButton.addEventListener('click', async () => {
  if (!maskHistory?.canRedo()) return;
  editMask = maskHistory.redo();
  renderOwnership.reviseMask();
  updatePreviewBounds();
  updateEditorButtons();
  await runExport();
});
resetMaskButton.addEventListener('click', async () => {
  if (!maskHistory) return;
  editMask = maskHistory.reset();
  renderOwnership.reviseMask();
  updatePreviewBounds();
  updateEditorButtons();
  await runExport();
});
backgroundOptions.addEventListener('change', () => {
  renderOwnership.reviseBackground();
  updatePreviewBounds();
  updateEditorButtons();
  exportResult().catch((error) => {
    status.textContent = `预览失败：${
      error instanceof Error ? error.message : String(error)
    }`;
  });
});

downloadButton.addEventListener('click', () => {
  const outputBlob = renderOwnership.outputBlob;
  if (!outputBlob || renderOwnership.pending) return;
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
