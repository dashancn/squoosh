import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../../remove-background/node_modules/playwright-core/index.mjs';
import { findChromiumExecutable } from '../corresponding-source/rebuild/chromium-executable.mjs';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const build = path.join(root, 'build');
const types = new Map([['.html','text/html'],['.js','text/javascript'],['.mjs','text/javascript'],['.css','text/css'],['.txt','text/plain'],['.json','application/json']]);
const headerText = await readFile(path.join(build, '_headers'), 'utf8');
const csp = headerText.match(/\/heic-converter\/\*\n\s+Content-Security-Policy:\s*([^\n]+)/)?.[1];
assert.ok(csp, 'generated production CSP header missing');
const server = createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const target = path.resolve(build, `.${pathname}`);
    if (target !== build && !target.startsWith(`${build}${path.sep}`)) throw new Error();
    const body = await readFile(target);
    response.writeHead(200, {'content-type': types.get(path.extname(target)) || 'application/octet-stream', 'content-security-policy': csp});
    response.end(body);
  } catch { if (!response.headersSent) response.writeHead(404); response.end('not found'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const sourceFiles=['heic-to-1.5.2.LICENSE.txt','heic-to-v1.5.2.tar.gz','libheif-v1.22.2.tar.gz','libde265-1.0.16.tar.gz','CORRESPONDING-SOURCE.md','LICENSES/libde265-LGPL-3.0.txt','rebuild/heic-to-worker-entry.mjs','rebuild/build.mjs','rebuild/package.json','rebuild/package-lock.json','rebuild/chromium-executable.mjs','rebuild/rebuild-and-verify.mjs'];
const licenseStatus=Object.fromEntries(await Promise.all(sourceFiles.map(async name=>[name,(await fetch(`${origin}/heic-converter/third-party/${name}`)).status])));
assert.ok(Object.values(licenseStatus).every(status=>status===200),JSON.stringify(licenseStatus));
const browser = await chromium.launch({ executablePath:findChromiumExecutable(), headless:true, args:['--no-sandbox','--disable-dev-shm-usage'] });
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
    const image=card.querySelector('img'); await image.decode();
    const c=document.createElement('canvas'); c.width=image.naturalWidth;c.height=image.naturalHeight;c.getContext('2d').drawImage(image,0,0);
    const pixel=[...c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data];
    const download=card.querySelector('a.download').download; const type=download.endsWith('.png')?'image/png':'image/jpeg';
    const size=window.outputBlobSizes.get(image.src);
    return {type,size,width:c.width,height:c.height,pixel,previewComplete:image.complete,download};
  });
}
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const cspViolations=[]; await page.exposeFunction('recordCspViolation', event=>cspViolations.push(event));
  await page.addInitScript(()=>{
    window.outputBlobSizes=new Map();
    const createObjectURL=URL.createObjectURL.bind(URL);
    URL.createObjectURL=(blob)=>{const url=createObjectURL(blob);window.outputBlobSizes.set(url,blob.size);return url};
    document.addEventListener('securitypolicyviolation', event=>window.recordCspViolation({blockedURI:event.blockedURI,violatedDirective:event.violatedDirective}));
  });
  page.on('pageerror', e=>errors.push(String(e)));
  const decoder=[]; const workerScripts=[]; const remoteRequests=[];
  page.on('request', r=>{const url=new URL(r.url());if(url.origin!==origin&&!['blob:','data:'].includes(url.protocol)) remoteRequests.push(r.url());if(r.url().includes('heic-to-1.5.2')) decoder.push(r.url());if(r.url().endsWith('/src/heic-worker.mjs')) workerScripts.push(r.url())});
  await page.exposeFunction('recordMainThreadHeicCall',()=>{throw new Error('HEIC decoder executed on the main thread')});
  await page.addInitScript(()=>{const original=Blob.prototype.arrayBuffer;Blob.prototype.arrayBuffer=function(){if(this.type==='image/heic'&&typeof document!=='undefined')window.recordMainThreadHeicCall();return original.call(this)}});
  await page.goto(`${origin}/heic-converter/`);
  const webp=await makeWebp(page);
  await page.locator('#files').setInputFiles({...webp,name:'mime-missing.bin',mimeType:''});
  await page.locator('#convert').click(); await page.waitForSelector('.result');
  let out=await inspectResult(page); assert.equal(out.type,'image/jpeg');assert.deepEqual([out.width,out.height],[31,19]);assert.ok(out.size>0&&out.previewComplete);assert.ok(out.pixel[0]>180&&out.pixel[1]<80);assert.equal(decoder.length,0,'WebP-only requested HEIC decoder');
  await page.locator('#files').setInputFiles({name:'renamed-fake.webp',mimeType:'image/webp',buffer:Buffer.from('not a WebP')});await page.locator('#status').filter({hasText:'不是受支持'}).waitFor();assert.equal(await page.locator('#convert').isDisabled(),true);assert.equal(decoder.length,0);
  await page.locator('#files').setInputFiles(webp);await page.locator('#convert:not([disabled])').waitFor();await page.locator('#convert').click();await page.waitForSelector('.result');
  await page.selectOption('#format','png'); await page.locator('#convert').click(); await page.locator('.result a[download$=".png"]').waitFor();
  out=await inspectResult(page);assert.equal(out.type,'image/png');assert.deepEqual([out.width,out.height],[31,19]);assert.ok(out.pixel[0]>180);assert.equal(decoder.length,0);

  await page.locator('#files').setInputFiles(heicFile); await page.locator('#convert:not([disabled])').waitFor(); await page.selectOption('#format','jpeg'); await page.locator('#convert').click(); await page.waitForSelector('.result',{timeout:300000});
  out=await inspectResult(page);assert.equal(out.type,'image/jpeg');assert.ok(out.width>0&&out.height>0&&out.size>0&&out.previewComplete);assert.ok(out.pixel[3]===255);assert.ok(decoder.length>0);assert.ok(workerScripts.length>0,'HEIC module worker was not requested');assert.match(await page.locator('#readiness').textContent(),/曾成功加载/);
  await page.selectOption('#format','png');await page.locator('#convert').click();await page.locator('.result a[download$=".png"]').waitFor({timeout:300000});out=await inspectResult(page);assert.equal(out.type,'image/png');assert.ok(out.size>0&&out.width>0);

  const webp2=await makeWebp(page,'mixed.webp','#205bd7');await page.locator('#files').setInputFiles([heicFile,webp2]);await page.locator('#convert:not([disabled])').waitFor();await page.locator('#convert').click();await page.locator('.result').nth(1).waitFor({timeout:300000});assert.equal(await page.locator('.result').count(),2);const mixed2=await inspectResult(page,1);assert.deepEqual([mixed2.width,mixed2.height],[31,19]);assert.ok(mixed2.pixel[2]>150);

  const lightboxA=await makeWebp(page,'lightbox-a.webp','#d43a2f');const lightboxB=await makeWebp(page,'lightbox-b.webp','#285fd4');await page.locator('#files').setInputFiles([lightboxA,lightboxB]);await page.locator('#convert:not([disabled])').waitFor();await page.locator('#convert').click();await page.locator('.result').nth(1).waitFor();
  const secondThumb=page.locator('.result-preview').nth(1);const secondSrc=await secondThumb.locator('img').getAttribute('src');assert.match(await secondThumb.getAttribute('aria-label'),/^放大查看/);await secondThumb.click();
  const dialog=page.locator('#lightbox');await dialog.waitFor({state:'visible'});assert.equal(await dialog.getAttribute('role'),'dialog');assert.equal(await dialog.getAttribute('aria-modal'),'true');assert.equal(await page.locator('#lightbox-image').getAttribute('src'),secondSrc);assert.equal(await page.locator('#lightbox-count').textContent(),'2 / 2');assert.equal(await page.evaluate(()=>document.activeElement?.id),'lightbox-close');assert.equal(await page.evaluate(()=>document.body.classList.contains('lightbox-open')),true);await page.locator('.lightbox-panel').click();assert.equal(await dialog.isVisible(),true);await page.locator('#lightbox').evaluate(element=>element.click());assert.equal(await dialog.isHidden(),true);await secondThumb.click();
  await page.locator('#lightbox-next').click();assert.equal(await page.locator('#lightbox-count').textContent(),'1 / 2');await page.locator('#lightbox-prev').click();assert.equal(await page.locator('#lightbox-count').textContent(),'2 / 2');
  await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#lightbox-count').textContent(),'1 / 2');await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('#lightbox-count').textContent(),'2 / 2');await page.keyboard.press('Escape');assert.equal(await dialog.isHidden(),true);assert.equal(await secondThumb.evaluate(el=>document.activeElement===el),true);
  await secondThumb.click();await page.locator('#lightbox-image').dispatchEvent('touchstart',{touches:[{identifier:1,target:null,clientX:280,clientY:200}]});await page.locator('#lightbox-image').dispatchEvent('touchend',{changedTouches:[{identifier:1,target:null,clientX:180,clientY:202}]});assert.equal(await page.locator('#lightbox-count').textContent(),'1 / 2');
  await page.locator('#lightbox-remove').click();assert.equal(await page.locator('.result').count(),1);assert.equal(await page.locator('#lightbox-count').textContent(),'1 / 1');assert.equal(await page.locator('#lightbox-next').isHidden(),true);await page.locator('#lightbox-remove').click();assert.equal(await dialog.isHidden(),true);assert.equal(await page.locator('.result').count(),0);
  await page.locator('#files').setInputFiles([lightboxA,lightboxB]);await page.locator('#convert:not([disabled])').waitFor();await page.locator('#convert').click();await page.locator('.result').nth(1).waitFor();await page.locator('.result-preview').first().click();await page.locator('#clear').evaluate(button=>button.click());assert.equal(await dialog.isHidden(),true);assert.equal(await page.locator('.result').count(),0);

  await page.locator('#files').setInputFiles(heicFile);await page.locator('#convert:not([disabled])').waitFor();await page.locator('#convert').click();await page.locator('#files').setInputFiles(await makeWebp(page,'new.webp','#25a244'));await page.waitForTimeout(1500);assert.equal(await page.locator('.result').count(),0,'stale HEIC result overwrote newer selection');assert.match(await page.locator('#selection').textContent(),/new\.webp/);
  await page.setViewportSize({width:375,height:900});await page.reload();const mobileA=await makeWebp(page,'mobile-a.webp','#d43a2f');const mobileB=await makeWebp(page,'mobile-b.webp','#285fd4');await page.locator('#files').setInputFiles([mobileA,mobileB]);await page.locator('#convert').click();await page.locator('.result').nth(1).waitFor();await page.locator('.result-preview').first().click();const layout=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,button:document.querySelector('#convert').getBoundingClientRect().width,prev:document.querySelector('#lightbox-prev').getBoundingClientRect(),next:document.querySelector('#lightbox-next').getBoundingClientRect(),dialog:document.querySelector('#lightbox').getBoundingClientRect()}));assert.equal(layout.scroll,layout.client);assert.ok(layout.button>100);assert.ok(layout.prev.width>=44&&layout.next.width>=44);assert.ok(layout.prev.left>=0&&layout.next.right<=layout.client);assert.ok(layout.dialog.left>=0&&layout.dialog.right<=layout.client);
  assert.deepEqual(remoteRequests,[]); assert.deepEqual(cspViolations,[]); assert.deepEqual(errors,[]);
  console.log(JSON.stringify({webp:{dimensions:[31,19],signatureWithoutMime:true,renamedFakeRejected:true,decoderRequests:0},heic:{dimensions:[out.width,out.height],decoderRequests:decoder.length,moduleWorkerRequests:workerScripts.length,mainThreadDecode:false},mixed:2,staleInvalidated:true,mobile:layout,errors},null,2));
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
