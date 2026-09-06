import { classifyFile, validateBatch, validateDimensions, outputFilename, encoderOptions, VersionOwner, readinessMessage, CACHE_KEY } from './core.mjs';

const $ = (id) => document.getElementById(id);
const input = $('files'), format = $('format'), quality = $('quality'), background = $('background');
const owner = new VersionOwner();
let selected = [], results = [], heicModule;

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
  $('selection').innerHTML = selected.map((x) => `<div class="file-row"><span>${escapeHtml(x.file.name)}</span><span>${x.kind.toUpperCase()} · ${bytes(x.file.size)}</span></div>`).join('');
  $('convert').disabled = !selected.length;
}
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function renderResults() {
  $('results').innerHTML = '';
  for (const [index, item] of results.entries()) {
    const card = document.createElement('article'); card.className = 'result'; card.dataset.index = index;
    card.innerHTML = `<img alt="${escapeHtml(item.name)} 转换预览" src="${item.url}"><div><h3>${escapeHtml(item.name)}</h3><p>${item.width} × ${item.height}</p><p>${bytes(item.inputBytes)} → ${bytes(item.blob.size)}</p></div><div class="result-actions"><a class="download" href="${item.url}" download="${escapeHtml(item.name)}">下载</a><button class="remove" type="button">移除</button></div>`;
    card.querySelector('.remove').addEventListener('click', () => { URL.revokeObjectURL(results[index].url); results.splice(index, 1); renderResults(); });
    $('results').append(card);
  }
  $('download-all').disabled = !results.length; $('clear').disabled = !results.length;
}
async function signature(file) {
  const data = new Uint8Array(await file.slice(8, 12).arrayBuffer());
  return ['mif1','msf1','heic','heix','hevc','hevx'].includes(new TextDecoder().decode(data).replace('\0',' ').trim());
}
input.addEventListener('change', async () => {
  owner.next();
  resetResults(); selected = []; $('status').textContent = '';
  try {
    const files = [...input.files]; validateBatch(files);
    for (const file of files) {
      const candidate = await signature(file);
      const heicSignature = candidate ? await (await loadHeic()).isHeic(file) : false;
      const kind = classifyFile(file, heicSignature);
      if (kind === 'unsupported') throw new Error(`${file.name} 不是受支持的 HEIC、HEIF 或 WebP 文件`);
      selected.push({ file, kind });
    }
    renderSelection();
  } catch (error) { selected = []; renderSelection(); $('status').textContent = error.message; }
});
async function loadHeic() {
  if (!heicModule) {
    $('readiness').textContent = '正在加载 HEIC 解码资源，请保持页面打开…';
    try { heicModule = await import('../third-party/heic-to-1.5.2.csp.js'); }
    catch (error) { $('readiness').textContent = 'HEIC 解码资源不可用，请检查网络后刷新重试。'; throw new Error('HEIC 解码资源不可用'); }
  }
  return heicModule;
}
async function decode(item) {
  if (item.kind === 'heic') {
    const { isHeic, heicTo } = await loadHeic();
    if (!await isHeic(item.file)) throw new Error(`${item.file.name} 的 HEIC 签名无效`);
    return createImageBitmap(await heicTo({ blob: item.file, type: 'image/png' }));
  }
  return createImageBitmap(item.file);
}
function canvasBlob(canvas, type, qualityValue) {
  return new Promise((resolve, reject) => { try { canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('浏览器无法导出图片')), type, qualityValue); } catch { reject(new Error('画布导出失败，图片可能过大')); } });
}
async function convertOne(item) {
  let bitmap;
  try {
    bitmap = await decode(item); validateDimensions(bitmap.width, bitmap.height);
    const opts = encoderOptions(format.value, Number(quality.value), background.value);
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器无法创建画布');
    if (opts.background) { ctx.fillStyle = opts.background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(bitmap, 0, 0);
    const blob = await canvasBlob(canvas, opts.type, opts.quality);
    return { name: outputFilename(item.file.name, format.value), width: bitmap.width, height: bitmap.height, inputBytes: item.file.size, blob, url: URL.createObjectURL(blob) };
  } catch (error) { throw new Error(`${item.file.name}：${error?.message || '转换失败，可能是内存不足'}`); }
  finally { bitmap?.close?.(); }
}
$('convert').addEventListener('click', async () => {
  const version = owner.next(); resetResults(); $('convert').disabled = true; $('status').textContent = '正在依次转换…';
  const next = [];
  try {
    for (let i = 0; i < selected.length; i++) {
      if (!owner.isCurrent(version)) { release(next); return; }
      $('status').textContent = `正在转换 ${i + 1} / ${selected.length}…`;
      next.push(await convertOne(selected[i]));
    }
    if (!owner.isCurrent(version)) { release(next); return; }
    results = next; renderResults(); $('status').textContent = `已完成 ${results.length} 个文件`;
    if (selected.some((x) => x.kind === 'heic')) { localStorage.setItem(CACHE_KEY, '1'); $('readiness').textContent = readinessMessage(localStorage); }
  } catch (error) { release(next); $('status').textContent = error.message; }
  finally { if (owner.isCurrent(version)) $('convert').disabled = !selected.length; }
});
$('clear').addEventListener('click', () => { owner.next(); resetResults(); selected = []; input.value = ''; renderSelection(); $('status').textContent = ''; });
$('download-all').addEventListener('click', () => { results.forEach((item, i) => setTimeout(() => { const a = document.createElement('a'); a.href = item.url; a.download = item.name; a.click(); }, i * 180)); });
window.addEventListener('pagehide', () => release(results));
