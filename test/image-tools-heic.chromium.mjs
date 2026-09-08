import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../remove-background/node_modules/playwright-core/index.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const build = path.join(root, 'build');
const headerText = await readFile(path.join(build, '_headers'), 'utf8');
const removalCsp = headerText.match(/Content-Security-Policy:\s*([^\n]+)/)?.[1];
const types = new Map([['.html','text/html'],['.js','text/javascript'],['.mjs','text/javascript'],['.css','text/css'],['.json','application/json'],['.wasm','application/wasm'],['.png','image/png']]);
const server = createServer(async (request,response) => {
  try {
    const url = new URL(request.url,'http://x'); let pathname=decodeURIComponent(url.pathname); if(pathname.endsWith('/')) pathname+='index.html';
    const target=path.resolve(build,`.${pathname}`); assert.ok(target === build || target.startsWith(`${build}${path.sep}`));
    const headers={'content-type':types.get(path.extname(target))||'application/octet-stream','cross-origin-resource-policy':'same-origin'};
    if(url.pathname.startsWith('/remove-background/') || url.pathname.startsWith('/heic-converter/')) Object.assign(headers,{'content-security-policy':removalCsp});
    response.writeHead(200,headers); response.end(await readFile(target));
  } catch { if (!response.headersSent) response.writeHead(404); response.end('not found'); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const heic=await readFile(new URL('../heic-converter/tests/fixtures/libheif-example.heic',import.meta.url));
const browser=await chromium.launch({executablePath:'/snap/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const errors=[];
try {
  const collage=await browser.newPage(); collage.on('pageerror',e=>errors.push(String(e)));
  const collageConsole=[]; collage.on('console',m=>collageConsole.push(`${m.type()}:${m.text()}`));
  const decoder=[]; const collageFailed=[]; collage.on('request',r=>{if(r.url().includes('heic-to-1.5.2'))decoder.push(r.url())}); collage.on('requestfailed',r=>collageFailed.push(`${r.url()}:${r.failure()?.errorText}`)); collage.on('response',r=>{if(r.status()>=400)collageFailed.push(`${r.url()}:${r.status()}`)});
  await collage.goto(`${origin}/collage/`);
  const heicFile={name:'initial.heic',mimeType:'image/heic',buffer:heic};
  await collage.locator('#files').setInputFiles(heicFile);
  try { await collage.waitForFunction(()=>document.documentElement.dataset.state==='complete',null,{timeout:300000}); }
  catch (error) { throw new Error(`initial collage HEIC failed: ${await collage.locator('#status').textContent()} | file=${JSON.stringify(await collage.locator('#files').evaluate(e=>({count:e.files.length,name:e.files[0]?.name})))} | console=${collageConsole.join(' | ')} | failed=${collageFailed.join(' | ')} | ${errors.join(' | ')}`, { cause: error }); }
  assert.match(await collage.locator('.thumbnail').first().getAttribute('aria-label'),/initial\.png/);
  await collage.locator('#add-images').setInputFiles({...heicFile,name:'added.heif'});
  await collage.waitForFunction(()=>document.querySelectorAll('.thumbnail').length===2&&document.documentElement.dataset.state==='complete',null,{timeout:300000});
  assert.match(await collage.locator('.thumbnail').nth(1).getAttribute('aria-label'),/added\.png/);
  await collage.evaluate(async bytes=>{const f=new File([new Uint8Array(bytes)],'dropped.heic',{type:'image/heic'});const dt=new DataTransfer();dt.items.add(f);document.querySelector('#drop-zone').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));},[...heic]);
  await collage.locator('.thumbnail[aria-label*="dropped.png"]').waitFor({timeout:300000});
  await collage.locator('#download[href^="blob:"]').waitFor({timeout:300000});
  assert.match(await collage.locator('.thumbnail').first().getAttribute('aria-label'),/dropped\.png/);
  const collageBlob=await collage.evaluate(async()=>{const b=await(await fetch(document.querySelector('#download').href)).blob();return {type:b.type,size:b.size}}); assert.equal(collageBlob.type,'image/png');assert.ok(collageBlob.size>8);assert.ok(decoder.length>0);

  await collage.close();
  const removal=await browser.newPage(); removal.on('pageerror',e=>errors.push(String(e)));
  const removalConsole=[]; const removalRequests=[];
  removal.on('console',m=>{if(m.type()==='error')removalConsole.push(m.text())});
  removal.on('request',r=>removalRequests.push(r.url()));
  await removal.goto(`${origin}/remove-background/`);
  await removal.locator('#file-input').setInputFiles({...heicFile,name:'subject.heic'});
  await removal.locator('#start-button').click();
  try { await removal.locator('#status').filter({hasText:'抠图完成'}).waitFor({timeout:300000}); }
  catch (error) { throw new Error(`HEIC removal failed: ${await removal.locator('#status').textContent()} | console=${removalConsole.join(' | ')} | heicRequests=${removalRequests.filter(x=>x.includes('heic')).join(',')}`, { cause: error }); }
  const removalBlob=await removal.evaluate(async()=>{const b=await new Promise(r=>document.querySelector('#preview').toBlob(r,'image/png'));return {type:b.type,size:b.size,width:document.querySelector('#preview').width,height:document.querySelector('#preview').height}});assert.equal(removalBlob.type,'image/png');assert.ok(removalBlob.size>8&&removalBlob.width>0&&removalBlob.height>0);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({collage:{initial:true,add:true,drop:true,decoderRequests:decoder.length,output:collageBlob},removeBackground:{heic:true,output:removalBlob},errors},null,2));
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
