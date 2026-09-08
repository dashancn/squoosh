import { removeBackground } from '@imgly/background-removal';
import { decodeAndValidateRemovalInput } from './input-limits.js';
import {
  normalizeImageFile,
  terminateSharedHeicDecoder,
} from '../../heic-converter/src/input-adapter.mjs';
import {
  applyBrushStamp,
  brushIndicatorDiameter,
  brushIndicatorVisible,
  clampPreviewPan,
  composeCroppedPixels,
  containedImageRect,
  createMaskHistory,
  createRenderOwnership,
  normalizeCropRect,
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
const previewPanel = $('.preview-panel');
const previewEmpty = $('#preview-empty');
const brushIndicator = $('#brush-indicator');
const zoomOutButton = $('#zoom-out-button');
const zoomInButton = $('#zoom-in-button');
const zoomResetButton = $('#zoom-reset-button');
const zoomOutput = $('#zoom-output');
const panModeButton = $('#pan-mode-button');
const cropControls = $('#crop-controls');
const cropModeButton = $('#crop-mode-button');
const applyCropButton = $('#apply-crop-button');
const resetCropButton = $('#reset-crop-button');
const cropOutput = $('#crop-output');
const cropSelection = $('#crop-selection');
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
let previewImage = null;
let brushMode = 'erase';
let activePointer = null;
let lastPoint = null;
let strokeChanged = false;
let strokeBounds = null;
let strokeRecorder = null;
let previewZoom = 1;
let previewPan = { x: 0, y: 0 };
let panMode = false;
let panStart = null;
let cropMode = false;
let cropStart = null;
let cropDraft = null;
let appliedCrop = null;
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
  zoomOutButton.disabled = !maskHistory || previewZoom <= 1;
  zoomInButton.disabled = !maskHistory || previewZoom >= 8;
  zoomResetButton.disabled = !maskHistory || previewZoom === 1;
  panModeButton.disabled = !maskHistory || previewZoom === 1;
  cropModeButton.disabled = !maskHistory;
  applyCropButton.disabled = !cropDraft;
  resetCropButton.disabled = !appliedCrop && !cropDraft;
  downloadButton.disabled =
    !renderOwnership.outputBlob || renderOwnership.pending;
}

function updatePreviewTransform() {
  const panelRect = previewPanel.getBoundingClientRect();
  const fit = containedImageRect(
    { left: 0, top: 0, width: panelRect.width, height: panelRect.height },
    preview.width,
    preview.height,
  );
  previewPan = fit
    ? clampPreviewPan(previewPan, previewZoom, fit.width, fit.height)
    : { x: 0, y: 0 };
  preview.style.transform = `scale(${previewZoom}) translate(${previewPan.x}px, ${previewPan.y}px)`;
  preview.style.transformOrigin = 'center';
  zoomOutput.value = `${Math.round(previewZoom * 100)}%`;
  zoomOutput.textContent = zoomOutput.value;
  if (previewZoom === 1 && panMode) setPanMode(false);
  updateCropSelection();
  updateEditorButtons();
}

function setPreviewZoom(nextZoom) {
  previewZoom = Math.max(1, Math.min(8, nextZoom));
  updatePreviewTransform();
}

function setPanMode(enabled) {
  panMode = Boolean(enabled && previewZoom > 1);
  if (!panMode) {
    activePointer = null;
    panStart = null;
  }
  if (panMode) setCropMode(false);
  panModeButton.classList.toggle('active', panMode);
  panModeButton.setAttribute('aria-pressed', String(panMode));
  preview.classList.toggle('panning', panMode);
  brushIndicator.hidden = true;
}

function setCropMode(enabled) {
  cropMode = Boolean(enabled && editMask);
  if (cropMode && panMode) {
    panMode = false;
    panModeButton.classList.remove('active');
    panModeButton.setAttribute('aria-pressed', 'false');
    preview.classList.remove('panning');
  }
  cropModeButton.classList.toggle('active', cropMode);
  cropModeButton.setAttribute('aria-pressed', String(cropMode));
  preview.classList.toggle('cropping', cropMode);
  brushIndicator.hidden = true;
}

function displayedCropRect(crop) {
  const imageRect = displayedImageRect();
  if (!crop || !imageRect) return null;
  const visibleCrop = appliedCrop || {
    x: 0,
    y: 0,
    width: sourceWidth,
    height: sourceHeight,
  };
  return {
    left:
      imageRect.left +
      ((crop.x - visibleCrop.x) / visibleCrop.width) * imageRect.width,
    top:
      imageRect.top +
      ((crop.y - visibleCrop.y) / visibleCrop.height) * imageRect.height,
    width: (crop.width / visibleCrop.width) * imageRect.width,
    height: (crop.height / visibleCrop.height) * imageRect.height,
  };
}

function updateCropSelection() {
  const crop = cropDraft || appliedCrop;
  const rect = displayedCropRect(crop);
  if (!rect) {
    cropSelection.hidden = true;
  } else {
    const panelRect = previewPanel.getBoundingClientRect();
    cropSelection.style.left = `${rect.left - panelRect.left}px`;
    cropSelection.style.top = `${rect.top - panelRect.top}px`;
    cropSelection.style.width = `${rect.width}px`;
    cropSelection.style.height = `${rect.height}px`;
    cropSelection.hidden = false;
  }
  cropOutput.value = crop
    ? `${crop.width} × ${crop.height} px${cropDraft ? '（待应用）' : ''}`
    : '完整图片';
  cropOutput.textContent = cropOutput.value;
  updateEditorButtons();
}

function setBrushMode(mode) {
  brushMode = mode;
  const erasing = mode === 'erase';
  eraseMode.classList.toggle('active', erasing);
  restoreMode.classList.toggle('active', !erasing);
  eraseMode.setAttribute('aria-pressed', String(erasing));
  restoreMode.setAttribute('aria-pressed', String(!erasing));
}

function makePreview() {
  const crop = appliedCrop || {
    x: 0,
    y: 0,
    width: sourceWidth,
    height: sourceHeight,
  };
  const scale = Math.min(
    1,
    MAX_PREVIEW_EDGE / Math.max(crop.width, crop.height),
  );
  preview.width = Math.max(1, Math.round(crop.width * scale));
  preview.height = Math.max(1, Math.round(crop.height * scale));
  previewImage = previewContext.createImageData(preview.width, preview.height);
  updatePreviewBounds();
}

function updatePreviewBounds(bounds = null) {
  if (
    !sourcePixels ||
    !previewImage ||
    !editMask ||
    !sourceWidth ||
    !sourceHeight
  )
    return;
  const background = backgrounds[selectedBackground()];
  const crop = appliedCrop || {
    x: 0,
    y: 0,
    width: sourceWidth,
    height: sourceHeight,
  };
  const scaleX = crop.width / preview.width;
  const scaleY = crop.height / preview.height;
  let left = 0;
  let top = 0;
  let right = preview.width - 1;
  let bottom = preview.height - 1;
  if (bounds) {
    if (
      bounds.right < crop.x ||
      bounds.bottom < crop.y ||
      bounds.left >= crop.x + crop.width ||
      bounds.top >= crop.y + crop.height
    )
      return;
    left = Math.max(0, Math.floor((bounds.left - crop.x) / scaleX) - 1);
    top = Math.max(0, Math.floor((bounds.top - crop.y) / scaleY) - 1);
    right = Math.min(
      preview.width - 1,
      Math.ceil((bounds.right - crop.x) / scaleX) + 1,
    );
    bottom = Math.min(
      preview.height - 1,
      Math.ceil((bounds.bottom - crop.y) / scaleY) + 1,
    );
  }
  for (let y = top; y <= bottom; y += 1) {
    const sourceY = Math.min(
      sourceHeight - 1,
      crop.y + Math.floor((y + 0.5) * scaleY),
    );
    for (let x = left; x <= right; x += 1) {
      const sourceX = Math.min(
        sourceWidth - 1,
        crop.x + Math.floor((x + 0.5) * scaleX),
      );
      const sourceIndex = sourceY * sourceWidth + sourceX;
      const pixelIndex = (y * preview.width + x) * 4;
      const alpha = Math.min(originalAlpha[sourceIndex], editMask[sourceIndex]);
      if (!background) {
        previewImage.data[pixelIndex] = sourcePixels[sourceIndex * 4];
        previewImage.data[pixelIndex + 1] = sourcePixels[sourceIndex * 4 + 1];
        previewImage.data[pixelIndex + 2] = sourcePixels[sourceIndex * 4 + 2];
        previewImage.data[pixelIndex + 3] = alpha;
      } else {
        const amount = alpha / 255;
        previewImage.data[pixelIndex] = Math.round(
          sourcePixels[sourceIndex * 4] * amount + background[0] * (1 - amount),
        );
        previewImage.data[pixelIndex + 1] = Math.round(
          sourcePixels[sourceIndex * 4 + 1] * amount +
            background[1] * (1 - amount),
        );
        previewImage.data[pixelIndex + 2] = Math.round(
          sourcePixels[sourceIndex * 4 + 2] * amount +
            background[2] * (1 - amount),
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
        const crop = appliedCrop || {
          x: 0,
          y: 0,
          width: sourceWidth,
          height: sourceHeight,
        };
        let output = composeCroppedPixels(
          sourcePixels,
          editMask,
          sourceWidth,
          sourceHeight,
          crop,
          background,
        );
        if (!renderOwnership.isCurrent(token)) {
          output.fill(0);
          output = null;
          return;
        }
        exportCanvas.width = crop.width;
        exportCanvas.height = crop.height;
        exportContext.putImageData(
          new ImageData(output, crop.width, crop.height),
          0,
          0,
        );
        output.fill(0);
        output = null;
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
  panStart = null;
}

function clearEditor() {
  releaseActivePointer();
  renderOwnership.select(selectedVersion);
  sourcePixels?.fill(0);
  originalAlpha?.fill(0);
  editMask?.fill(0);
  previewImage?.data.fill(0);
  maskHistory?.clear?.();
  sourcePixels = null;
  originalAlpha = null;
  editMask = null;
  maskHistory = null;
  previewImage = null;
  sourceWidth = 0;
  sourceHeight = 0;
  previewZoom = 1;
  previewPan = { x: 0, y: 0 };
  cropStart = null;
  cropDraft = null;
  appliedCrop = null;
  setCropMode(false);
  setPanMode(false);
  updatePreviewTransform();
  updateCropSelection();
  preview.width = 0;
  preview.height = 0;
  exportCanvas.width = 0;
  exportCanvas.height = 0;
  cropControls.disabled = true;
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
  cropControls.disabled = true;
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
    makePreview();
    backgroundOptions.disabled = false;
    cropControls.disabled = false;
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
  const crop = appliedCrop || {
    x: 0,
    y: 0,
    width: sourceWidth,
    height: sourceHeight,
  };
  const point = toContainedSourcePoint(
    event.clientX,
    event.clientY,
    displayedImageRect(),
    crop.width,
    crop.height,
  );
  return point ? { x: point.x + crop.x, y: point.y + crop.y } : null;
}

function displayedImageRect() {
  const panelRect = previewPanel.getBoundingClientRect();
  const viewportBox = {
    left: panelRect.left,
    top: panelRect.top,
    width: preview.clientWidth,
    height: preview.clientHeight,
  };
  const fit = containedImageRect(viewportBox, preview.width, preview.height);
  if (!fit) return null;
  return {
    left:
      fit.left +
      fit.width / 2 -
      (fit.width * previewZoom) / 2 +
      previewPan.x * previewZoom,
    top:
      fit.top +
      fit.height / 2 -
      (fit.height * previewZoom) / 2 +
      previewPan.y * previewZoom,
    width: fit.width * previewZoom,
    height: fit.height * previewZoom,
  };
}

function updateBrushIndicator(event) {
  const imageRect = displayedImageRect();
  const point = eventSourcePoint(event);
  if (
    !brushIndicatorVisible({
      point,
      hasMask: Boolean(editMask),
      busy,
      cropMode,
    })
  ) {
    brushIndicator.hidden = true;
    return;
  }
  const panelRect = previewPanel.getBoundingClientRect();
  const crop = appliedCrop || {
    width: sourceWidth,
    height: sourceHeight,
  };
  const diameter = brushIndicatorDiameter(
    brushSize.value,
    imageRect,
    crop.width,
    crop.height,
  );
  brushIndicator.style.left = `${event.clientX - panelRect.left}px`;
  brushIndicator.style.top = `${event.clientY - panelRect.top}px`;
  brushIndicator.style.width = `${diameter}px`;
  brushIndicator.style.height = `${diameter}px`;
  brushIndicator.hidden = false;
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
  if (panMode) {
    event.preventDefault();
    activePointer = event.pointerId;
    panStart = {
      clientX: event.clientX,
      clientY: event.clientY,
      pan: { ...previewPan },
    };
    try {
      preview.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer tests and some browser transitions cannot capture.
    }
    return;
  }
  if (cropMode) {
    const point = eventSourcePoint(event);
    if (!point) return;
    event.preventDefault();
    activePointer = event.pointerId;
    cropStart = point;
    cropDraft = normalizeCropRect(point, point, sourceWidth, sourceHeight);
    try {
      preview.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer tests and some browser transitions cannot capture.
    }
    updateCropSelection();
    return;
  }
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
  if (!panMode) updateBrushIndicator(event);
  if (event.pointerId !== activePointer || !editMask) return;
  if (panMode && activePointer !== null) {
    event.preventDefault();
    const origin = panStart || {
      clientX: event.clientX,
      clientY: event.clientY,
      pan: { ...previewPan },
    };
    previewPan = {
      x: origin.pan.x + (event.clientX - origin.clientX) / previewZoom,
      y: origin.pan.y + (event.clientY - origin.clientY) / previewZoom,
    };
    updatePreviewTransform();
    return;
  }
  if (panStart) {
    event.preventDefault();
    previewPan = {
      x: panStart.pan.x + (event.clientX - panStart.clientX) / previewZoom,
      y: panStart.pan.y + (event.clientY - panStart.clientY) / previewZoom,
    };
    updatePreviewTransform();
    return;
  }
  if (cropStart) {
    const point = eventSourcePoint(event);
    if (!point) return;
    event.preventDefault();
    cropDraft = normalizeCropRect(cropStart, point, sourceWidth, sourceHeight);
    updateCropSelection();
    return;
  }
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
preview.addEventListener('pointerleave', () => {
  if (activePointer === null) brushIndicator.hidden = true;
});

async function finishStroke(event) {
  if (event.pointerId !== activePointer) return;
  const finishedPan = Boolean(panStart);
  const finishedCrop = Boolean(cropStart);
  try {
    if (preview.hasPointerCapture(event.pointerId))
      preview.releasePointerCapture(event.pointerId);
  } catch {
    // lostpointercapture can arrive after automatic release.
  }
  activePointer = null;
  lastPoint = null;
  panStart = null;
  cropStart = null;
  if (finishedPan || finishedCrop) {
    updateCropSelection();
    return;
  }
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
zoomOutButton.addEventListener('click', () =>
  setPreviewZoom(previewZoom / 1.25),
);
zoomInButton.addEventListener('click', () =>
  setPreviewZoom(previewZoom * 1.25),
);
zoomResetButton.addEventListener('click', () => {
  previewPan = { x: 0, y: 0 };
  setPreviewZoom(1);
});
panModeButton.addEventListener('click', () => setPanMode(!panMode));
cropModeButton.addEventListener('click', () => setCropMode(!cropMode));
applyCropButton.addEventListener('click', async () => {
  if (!cropDraft) return;
  appliedCrop = cropDraft;
  cropDraft = null;
  setCropMode(false);
  previewPan = { x: 0, y: 0 };
  previewZoom = 1;
  renderOwnership.reviseCrop();
  makePreview();
  updatePreviewTransform();
  updateCropSelection();
  await runExport();
});
resetCropButton.addEventListener('click', async () => {
  if (!cropDraft && !appliedCrop) return;
  cropDraft = null;
  appliedCrop = null;
  setCropMode(false);
  previewPan = { x: 0, y: 0 };
  previewZoom = 1;
  renderOwnership.reviseCrop();
  makePreview();
  updatePreviewTransform();
  updateCropSelection();
  await runExport();
});
previewPanel.addEventListener(
  'wheel',
  (event) => {
    if (!editMask) return;
    event.preventDefault();
    setPreviewZoom(previewZoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
  },
  { passive: false },
);
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
