import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../../remove-background/node_modules/playwright-core/index.mjs';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const build = path.join(root, 'build');
const types = new Map([['.html','text/html'],['.js','text/javascript'],['.mjs','text/javascript'],['.css','text/css'],['.txt','text/plain'],['.json','application/json']]);
const server = createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const target = path.resolve(build, `.${pathname}`);
    if (target !== build && !target.startsWith(`${build}${path.sep}`)) throw new Error();
    const body = await readFile(target);
    response.writeHead(200, {'content-type': types.get(path.extname(target)) || 'application/octet-stream'});
    response.end(body);
  } catch { if (!response.headersSent) response.writeHead(404); response.end('not found'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath:'/snap/bin/chromium', headless:true, args:['--no-sandbox','--disable-dev-shm-usage'] });
const errors = [];
const heicBytes = await readFile(new URL('./fixtures/libheif-example.heic', import.meta.url));
const heicFile = { name: 'example.heic', mimeType: 'image/heic', buffer: heicBytes };

async function makeWebp(page, name='fixture.webp', color='#e31b23') {
  return page.evaluate(async ({name,color}) => {
    const c=document.createElement('canvas'); c.width=31; c.height=19; const x=c.getContext('2d'); x.fillStyle=color; x.fillRect(0,0,c.width,c.height);
    const blob=await new Promise(r=>c.toBlob(r,'image/webp',.95)); return {name,mimeType:'image/webp',buffer:[...new Uint8Array(await blob.arrayBuffer())]};
  }, {name,color}).then(x=>({...x,buffer:Buffer.from(x.buffer)}));
}
async function inspectResult(page, index=0) {
  return page.locator('.result').nth(index).evaluate(async (card) => {
    const response=await fetch(card.querySelector('a.download').href); const blob=await response.blob(); const bitmap=await createImageBitmap(blob);
    const c=document.createElement('canvas'); c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d').drawImage(bitmap,0,0);
    const pixel=[...c.getContext('2d').getImageData(Math.floor(bitmap.width/2),Math.floor(bitmap.height/2),1,1).data];
    bitmap.close(); return {type:blob.type,size:blob.size,width:c.width,height:c.height,pixel,previewComplete:card.querySelector('img').complete,download:card.querySelector('a').download};
  });
}
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.on('pageerror', e=>errors.push(String(e)));
  const decoder=[]; const workerScripts=[];
  page.on('request', r=>{if(r.url().includes('heic-to-1.5.2')) decoder.push(r.url());if(r.url().endsWith('/src/heic-worker.mjs')) workerScripts.push(r.url())});
  await page.exposeFunction('recordMainThreadHeicCall',()=>{throw new Error('HEIC decoder executed on the main thread')});
  await page.addInitScript(()=>{const original=Blob.prototype.arrayBuffer;Blob.prototype.arrayBuffer=function(){if(this.type==='image/heic'&&typeof document!=='undefined')window.recordMainThreadHeicCall();return original.call(this)}});
  await page.goto(`${origin}/heic-converter/`);
  const webp=await makeWebp(page);
  await page.locator('#files').setInputFiles({...webp,name:'mime-missing.bin',mimeType:''});
  await page.locator('#convert').click(); await page.waitForSelector('.result');
  let out=await inspectResult(page); assert.equal(out.type,'image/jpeg');assert.deepEqual([out.width,out.height],[31,19]);assert.ok(out.size>0&&out.previewComplete);assert.ok(out.pixel[0]>180&&out.pixel[1]<80);assert.equal(decoder.length,0,'WebP-only requested HEIC decoder');
  await page.locator('#files').setInputFiles({name:'renamed-fake.webp',mimeType:'image/webp',buffer:Buffer.from('not a WebP')});await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('不是受支持'));assert.equal(await page.locator('#convert').isDisabled(),true);assert.equal(decoder.length,0);
  await page.locator('#files').setInputFiles(webp);await page.waitForFunction(()=>!document.querySelector('#convert').disabled);await page.locator('#convert').click();await page.waitForSelector('.result');
  await page.selectOption('#format','png'); await page.locator('#convert').click(); await page.waitForFunction(()=>document.querySelector('.result a')?.download.endsWith('.png'));
  out=await inspectResult(page);assert.equal(out.type,'image/png');assert.deepEqual([out.width,out.height],[31,19]);assert.ok(out.pixel[0]>180);assert.equal(decoder.length,0);

  await page.locator('#files').setInputFiles(heicFile); await page.waitForFunction(()=>!document.querySelector('#convert').disabled); await page.selectOption('#format','jpeg'); await page.locator('#convert').click(); await page.waitForSelector('.result',{timeout:300000});
  out=await inspectResult(page);assert.equal(out.type,'image/jpeg');assert.ok(out.width>0&&out.height>0&&out.size>0&&out.previewComplete);assert.ok(out.pixel[3]===255);assert.ok(decoder.length>0);assert.ok(workerScripts.length>0,'HEIC module worker was not requested');assert.match(await page.locator('#readiness').textContent(),/曾成功加载/);
  await page.selectOption('#format','png');await page.locator('#convert').click();await page.waitForFunction(()=>document.querySelector('.result a')?.download.endsWith('.png'),null,{timeout:300000});out=await inspectResult(page);assert.equal(out.type,'image/png');assert.ok(out.size>0&&out.width>0);

  const webp2=await makeWebp(page,'mixed.webp','#205bd7');await page.locator('#files').setInputFiles([heicFile,webp2]);await page.waitForFunction(()=>!document.querySelector('#convert').disabled);await page.locator('#convert').click();await page.waitForFunction(()=>document.querySelectorAll('.result').length===2,null,{timeout:300000});assert.equal(await page.locator('.result').count(),2);const mixed2=await inspectResult(page,1);assert.deepEqual([mixed2.width,mixed2.height],[31,19]);assert.ok(mixed2.pixel[2]>150);

  await page.locator('#files').setInputFiles(heicFile);await page.waitForFunction(()=>!document.querySelector('#convert').disabled);await page.locator('#convert').click();await page.locator('#files').setInputFiles(await makeWebp(page,'new.webp','#25a244'));await page.waitForTimeout(1500);assert.equal(await page.locator('.result').count(),0,'stale HEIC result overwrote newer selection');assert.match(await page.locator('#selection').textContent(),/new\.webp/);
  const licenseStatus=await page.evaluate(async()=>({license:(await fetch('./third-party/heic-to-1.5.2.LICENSE.txt')).status,source:(await fetch('./third-party/heic-to-1.5.2-source/index.js')).status,library:(await fetch('./third-party/heic-to-1.5.2.worker.js')).status}));assert.deepEqual(licenseStatus,{license:200,source:200,library:200});
  await page.setViewportSize({width:375,height:900});await page.reload();const layout=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,button:document.querySelector('#convert').getBoundingClientRect().width}));assert.equal(layout.scroll,layout.client);assert.ok(layout.button>100);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({webp:{dimensions:[31,19],signatureWithoutMime:true,renamedFakeRejected:true,decoderRequests:0},heic:{dimensions:[out.width,out.height],decoderRequests:decoder.length,moduleWorkerRequests:workerScripts.length,mainThreadDecode:false},mixed:2,staleInvalidated:true,mobile:layout,errors},null,2));
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
