import { removeBackground } from '@imgly/background-removal';

const fileInput = document.querySelector('#file-input');
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

fileInput.addEventListener('change', () => {
  selectedVersion += 1;
  selectedFile = fileInput.files?.[0] || null;
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
    const foreground = await removeBackground(input, {
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
      setProgress(
        0,
        `抠图失败：${error instanceof Error ? error.message : String(error)}`,
      );
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
