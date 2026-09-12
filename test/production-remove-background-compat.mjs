import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '../remove-background/node_modules/playwright-core/index.mjs';

const base = process.env.TARGET || 'https://imgzip.i41.cn';
const expectedSha = process.env.EXPECTED_SHA;
assert.match(expectedSha || '', /^[0-9a-f]{40}$/, 'EXPECTED_SHA must be an exact commit SHA');
const fixture = await readFile(new URL('../heic-converter/tests/fixtures/libheif-example.heic', import.meta.url));
const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const evidence = [];
try {
  for (const viewport of [{width:1280,height:900},{width:390,height:844}]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(() => {
      globalThis.createImageBitmap = async () => { throw new Error('production compatibility rejection'); };
      Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: undefined });
    });
    const response = await page.goto(`${base}/remove-background/`, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200);
    const sourceHref = await page.locator('a[href*="github.com/dashancn/squoosh/tree/"]').getAttribute('href');
    assert.equal(sourceHref, `https://github.com/dashancn/squoosh/tree/${expectedSha}`);
    const png = await page.evaluate(async () => {
      const c=document.createElement('canvas');c.width=64;c.height=48;const x=c.getContext('2d');x.fillStyle='#e53935';x.fillRect(0,0,64,48);
      return [...new Uint8Array(await (await new Promise(r=>c.toBlob(r,'image/png'))).arrayBuffer())];
    });
    for (const file of [{name:'prod.png',mimeType:'image/png',buffer:Buffer.from(png)},{name:'prod.heic',mimeType:'image/heic',buffer:fixture}]) {
      await page.locator('#file-input').setInputFiles(file);
      await page.waitForFunction(() => !document.querySelector('#start-button').disabled && document.querySelector('#preview').width > 0 && document.querySelector('#preview-empty').hidden, null, {timeout:300000});
      const state = await page.evaluate(() => { const c=document.querySelector('#preview'); const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; const r=document.querySelector('.preview-panel').getBoundingClientRect(); return {width:c.width,height:c.height,nonempty:d.some((v,i)=>i%4===3&&v>0),visible:r.top<innerHeight&&r.bottom>0,overflow:document.documentElement.scrollWidth>innerWidth}; });
      assert.equal(state.nonempty, true); assert.equal(state.visible, true); assert.equal(state.overflow, false);
      evidence.push({base,viewport,file:file.name,state,sourceHref});
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(JSON.stringify(evidence,null,2));
} finally { await browser.close(); }
