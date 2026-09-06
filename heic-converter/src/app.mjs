import { classifyFile, hasWebpSignature, validateBatch, validateDimensions, outputFilename, encoderOptions, VersionOwner, readinessMessage, CACHE_KEY } from './core.mjs';
import { HeicWorkerClient } from './heic-worker-client.mjs';

const $ = (id) => document.getElementById(id);
const input = $('files'), format = $('format'), quality = $('quality'), background = $('background');
const owner = new VersionOwner();
let heicWorker = new HeicWorkerClient({ onProgress: (message) => $('status').textContent = message });
let selected = [], results = [];
let converting = false;
function resetHeicWorker() {
  heicWorker.terminate();
  heicWorker = new HeicWorkerClient({ onProgress: (message) => $('status').textContent = message });
}
function releaseHeicWorkerIfIdle() {
  if (!converting) resetHeicWorker();
}

$('readiness').textContent = readinessMessage(localStorage);
quality.addEventListener('input', () => $('quality-value').textContent = `${quality.value}%`);
format.addEventListener('change', () => {
  const jpg = format.value === 'jpeg';
  $('quality-wrap').hidden = !jpg;
  $('background-wrap').hidden = !jpg;
});

function release(items) { for (const item of items) if (item.url) URL.revokeObjectURL(item.url); }
function resetResults() { release(results); results = []; renderResults(); }
function bytes(n) { return n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1024 / 1024).toFixed(2)} MiB`; }
function renderSelection() {
  const container = $('selection'); container.replaceChildren();
  for (const item of selected) {
    const row = document.createElement('div'); row.className = 'file-row';
    const name = document.createElement('span'); name.textContent = item.file.name;
    const detail = document.createElement('span'); detail.textContent = `${item.kind.toUpperCase()} · ${bytes(item.file.size)}`;
    row.append(name, detail); container.append(row);
  }
  $('convert').disabled = converting || !selected.length;
}
function renderResults() {
  $('results').replaceChildren();
  for (const [index, item] of results.entries()) {
    const card = document.createElement('article'); card.className = 'result'; card.dataset.index = index;
    const image = document.createElement('img'); image.alt = `${item.name} 转换预览`; image.src = item.url;
    const info = document.createElement('div');
    const title = document.createElement('h3'); title.textContent = item.name;
    const dimensions = document.createElement('p'); dimensions.textContent = `${item.width} × ${item.height}`;
    const sizes = document.createElement('p'); sizes.textContent = `${bytes(item.inputBytes)} → ${bytes(item.blob.size)}`;
    info.append(title, dimensions, sizes);
    const actions = document.createElement('div'); actions.className = 'result-actions';
    const download = document.createElement('a'); download.className = 'download'; download.href = item.url; download.download = item.name; download.textContent = '下载';
    const remove = document.createElement('button'); remove.className = 'remove'; remove.type = 'button'; remove.textContent = '移除';
    remove.addEventListener('click', () => { URL.revokeObjectURL(results[index].url); results.splice(index, 1); renderResults(); });
    actions.append(download, remove); card.append(image, info, actions);
    $('results').append(card);
  }
  $('download-all').disabled = converting || !results.length; $('clear').disabled = converting || !results.length;
}
async function signatures(file) {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const brand = new TextDecoder().decode(head.subarray(8, 12)).replace('\0', ' ').trim();
  return { heicCandidate: ['mif1','msf1','heic','heix','hevc','hevx'].includes(brand), webp: hasWebpSignature(head) };
}
input.addEventListener('change', async () => {
  const version = owner.next();
  resetHeicWorker();
  resetResults(); selected = []; renderSelection(); $('status').textContent = '';
  try {
    const files = [...input.files]; validateBatch(files);
    for (const file of files) {
      const candidate = await signatures(file);
      if (!owner.isCurrent(version)) return;
      if (candidate.heicCandidate) $('readiness').textContent = '正在后台加载 HEIC 解码资源，请保持页面打开…';
      const inspection = candidate.heicCandidate ? await heicWorker.inspect(file) : { isHeic: false };
      if (!owner.isCurrent(version)) return;
      const kind = classifyFile(file, inspection.isHeic, candidate.webp);
      if (kind === 'unsupported') throw new Error(`${file.name} 不是受支持的 HEIC、HEIF 或 WebP 文件`);
      selected.push({ file, kind, width: inspection.width, height: inspection.height });
    }
    renderSelection();
    releaseHeicWorkerIfIdle();
  } catch (error) {
    if (!owner.isCurrent(version)) return;
    selected = []; renderSelection(); $('status').textContent = error.message;
    if (/资源不可用/.test(error.message)) $('readiness').textContent = 'HEIC 解码资源不可用，请检查网络后刷新重试。';
  }
});
async function decode(item) {
  if (item.kind === 'heic') {
    const { buffer, mimeType } = await heicWorker.convert(item.file);
    return createImageBitmap(new Blob([buffer], { type: mimeType }));
  }
  return createImageBitmap(item.file);
}
function canvasBlob(canvas, type, qualityValue) {
  return new Promise((resolve, reject) => { try { canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('浏览器无法导出图片')), type, qualityValue); } catch { reject(new Error('画布导出失败，图片可能过大')); } });
}
async function convertOne(item, settings) {
  let bitmap, canvas;
  try {
    bitmap = await decode(item); validateDimensions(bitmap.width, bitmap.height);
    const opts = encoderOptions(settings.format, settings.quality, settings.background);
    canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器无法创建画布');
    if (opts.background) { ctx.fillStyle = opts.background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(bitmap, 0, 0);
    const blob = await canvasBlob(canvas, opts.type, opts.quality);
    return { name: outputFilename(item.file.name, settings.format), width: bitmap.width, height: bitmap.height, inputBytes: item.file.size, blob, url: URL.createObjectURL(blob) };
  } catch (error) { throw new Error(`${item.file.name}：${error?.message || '转换失败，可能是内存不足'}`); }
  finally { bitmap?.close?.(); if (canvas) { canvas.width = 1; canvas.height = 1; } }
}
function setConverting(busy) {
  converting = busy;
  input.disabled = busy; format.disabled = busy; quality.disabled = busy; background.disabled = busy;
  renderSelection();
  renderResults();
}
$('convert').addEventListener('click', async () => {
  const version = owner.next();
  const settings = Object.freeze({ format: format.value, quality: Number(quality.value), background: background.value });
  resetResults(); setConverting(true); $('status').textContent = '正在依次转换…';
  const next = [];
  try {
    for (let i = 0; i < selected.length; i++) {
      if (!owner.isCurrent(version)) { release(next); return; }
      $('status').textContent = `正在转换 ${i + 1} / ${selected.length}…`;
      next.push(await convertOne(selected[i], settings));
    }
    if (!owner.isCurrent(version)) { release(next); return; }
    results = next; $('status').textContent = `已完成 ${results.length} 个文件`;
    if (selected.some((x) => x.kind === 'heic')) { localStorage.setItem(CACHE_KEY, '1'); $('readiness').textContent = readinessMessage(localStorage); }
  } catch (error) { release(next); $('status').textContent = error.message; }
  finally { if (owner.isCurrent(version)) setConverting(false); }
});
$('clear').addEventListener('click', () => { owner.next(); heicWorker.terminate(); resetResults(); selected = []; input.value = ''; renderSelection(); $('status').textContent = ''; });
$('download-all').addEventListener('click', () => {
  for (const item of results) {
    const a = document.createElement('a'); a.href = item.url; a.download = item.name; a.click();
  }
});
window.addEventListener('pagehide', () => { owner.next(); heicWorker.terminate(); release(results); });
