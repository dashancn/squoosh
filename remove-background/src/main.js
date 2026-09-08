import { removeBackground } from '@imgly/background-removal';
import { decodeAndValidateRemovalInput } from './input-limits.js';
import {
  normalizeImageFile,
  terminateSharedHeicDecoder,
} from '../../heic-converter/src/input-adapter.mjs';

const fileInput = document.querySelector('#file-input');
const dropZone = document.querySelector('#drop-zone');
const fileName = document.querySelector('#file-name');
const startButton = document.querySelector('#start-button');
const downloadButton = document.querySelector('#download-button');
const status = document.querySelector('#status');
const progress = document.querySelector('#progress');
const progressLabel = document.querySelector('#progress-label');
const backgroundOptions = document.querySelector('#background-options');
const preview = document.querySelector('#preview');
const previewEmpty = document.querySelector('#preview-empty');
const context = preview.getContext('2d');

let selectedFile = null;
let selectedVersion = 0;
let resultImage = null;
let outputBlob = null;
let busy = false;

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

function selectedBackground() {
  return document.querySelector('input[name="background"]:checked').value;
}

async function renderResult() {
  if (!resultImage) return;
  preview.width = resultImage.width;
  preview.height = resultImage.height;
  context.clearRect(0, 0, preview.width, preview.height);

  const backgrounds = {
    transparent: null,
    white: '#ffffff',
    blue: '#1677ff',
    red: '#e53935',
  };
  const fill = backgrounds[selectedBackground()];
  if (fill) {
    context.fillStyle = fill;
    context.fillRect(0, 0, preview.width, preview.height);
  }
  context.drawImage(resultImage, 0, 0);
  outputBlob = await new Promise((resolve, reject) =>
    preview.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG 导出失败'))),
      'image/png',
    ),
  );
  downloadButton.disabled = false;
}

function selectFile(file) {
  selectedVersion += 1;
  selectedFile = file || null;
  resultImage = null;
  outputBlob = null;
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

fileInput.addEventListener('change', () => {
  selectFile(fileInput.files?.[0]);
});
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
  setProgress(1, '正在准备图片…');

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
    resultImage = await decodeBlob(foreground);
    if (version !== selectedVersion) return;
    backgroundOptions.disabled = false;
    previewEmpty.hidden = true;
    await renderResult();
    setProgress(100, '抠图完成，可选择背景并下载 PNG');
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
    if (version === selectedVersion) {
      busy = false;
      startButton.disabled = !selectedFile;
    }
  }
});

backgroundOptions.addEventListener('change', () => {
  renderResult().catch((error) => {
    status.textContent = `预览失败：${
      error instanceof Error ? error.message : String(error)
    }`;
  });
});

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
  resultImage?.close?.();
});
