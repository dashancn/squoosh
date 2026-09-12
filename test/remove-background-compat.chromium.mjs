import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../remove-background/node_modules/playwright-core/index.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const build = path.join(root, 'build');
const fixture = await readFile(path.join(root, 'heic-converter/tests/fixtures/libheif-example.heic'));
const types = new Map([['.html','text/html'],['.js','text/javascript'],['.mjs','text/javascript'],['.css','text/css'],['.json','application/json'],['.wasm','application/wasm'],['.png','image/png']]);
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://x');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const target = path.resolve(build, `.${pathname}`);
    assert.ok(target.startsWith(`${build}${path.sep}`));
    response.writeHead(200, {'content-type': types.get(path.extname(target)) || 'application/octet-stream'});
    response.end(await readFile(target));
  } catch { if (!response.headersSent) response.writeHead(404); response.end('not found'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const results = [];
try {
  for (const viewport of [{width:1280,height:900},{width:390,height:844},{width:360,height:800}]) {
    for (const bitmapMode of ['reject','absent']) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.addInitScript((mode) => {
        if (mode === 'reject') globalThis.createImageBitmap = async () => { throw new Error('compat rejection'); };
        else Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: undefined });
        Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: undefined });
      }, bitmapMode);
      await page.goto(`${origin}/remove-background/`);
      if (viewport.width <= 390) {
        const toolbar = await page.locator('.preview-toolbar').evaluate((element) => {
          const panel = element.parentElement.getBoundingClientRect();
          const rect = element.getBoundingClientRect();
          const labels = [...element.querySelectorAll('button')].map((button) => ({
            text: button.textContent.trim(),
            whiteSpace: getComputedStyle(button).whiteSpace,
            height: button.getBoundingClientRect().height,
          }));
          return {
            bottomInset: panel.bottom - rect.bottom,
            panelHeight: panel.height,
            toolbarHeight: rect.height,
            labels,
          };
        });
        assert.ok(toolbar.bottomInset <= 12, JSON.stringify({ viewport, toolbar }));
        assert.ok(toolbar.toolbarHeight <= 52, JSON.stringify({ viewport, toolbar }));
        assert.ok(toolbar.toolbarHeight / toolbar.panelHeight < 0.16, JSON.stringify({ viewport, toolbar }));
        assert.ok(toolbar.labels.every((label) => label.whiteSpace === 'nowrap'), JSON.stringify({ viewport, toolbar }));
      }
      const png = await page.evaluate(async () => {
        const canvas=document.createElement('canvas'); canvas.width=64; canvas.height=48;
        const context=canvas.getContext('2d'); context.fillStyle='#e53935';context.fillRect(0,0,64,48);
        return [...new Uint8Array(await (await new Promise(r=>canvas.toBlob(r,'image/png'))).arrayBuffer())];
      });
      const jpg = await page.evaluate(async () => {
        const canvas=document.createElement('canvas'); canvas.width=80; canvas.height=60;
        const context=canvas.getContext('2d'); context.fillStyle='#1565c0';context.fillRect(0,0,80,60);
        return [...new Uint8Array(await (await new Promise(r=>canvas.toBlob(r,'image/jpeg',.9))).arrayBuffer())];
      });
      for (const file of [
        {name:'fixture.png',mimeType:'image/png',buffer:Buffer.from(png)},
        {name:'fixture.jpg',mimeType:'image/jpeg',buffer:Buffer.from(jpg)},
        {name:'fixture.heic',mimeType:'image/heic',buffer:fixture},
      ]) {
        await page.locator('#file-input').setInputFiles(file);
        await page.waitForFunction(() => !document.querySelector('#start-button').disabled && document.querySelector('#preview').width > 0 && document.querySelector('#preview-empty').hidden, null, {timeout:300000});
        const state = await page.evaluate(() => {
          const canvas=document.querySelector('#preview'); const rect=canvas.getBoundingClientRect();
          const panel=document.querySelector('.preview-panel').getBoundingClientRect();
          const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
          return {width:canvas.width,height:canvas.height,nonempty:data.some((v,i)=>i%4===3&&v>0),panelTop:panel.top,panelBottom:panel.bottom,viewportHeight:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,startDisabled:document.querySelector('#start-button').disabled};
        });
        assert.equal(state.nonempty, true, JSON.stringify({viewport,bitmapMode,file:file.name,state}));
        assert.equal(state.startDisabled, false);
        assert.equal(state.overflow, false);
        if (viewport.width <= 390) assert.ok(state.panelTop < state.viewportHeight && state.panelBottom > 0, JSON.stringify({viewport,bitmapMode,file:file.name,state}));
        results.push({viewport,bitmapMode,file:file.name,state});
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
