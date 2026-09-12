import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = new URL('..', import.meta.url);
const routes = ['/', '/heic-converter/', '/remove-background/', '/collage/'];
let server;
let origin;

async function availablePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler exited with ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('timed out waiting for wrangler pages dev');
}

before(async () => {
  await run('npm', ['run', 'build'], { cwd: root, timeout: 300_000 });
  const port = await availablePort();
  origin = `http://127.0.0.1:${port}`;
  server = spawn('npx', ['wrangler', 'pages', 'dev', 'build', '--ip', '127.0.0.1', '--port', String(port), '--compatibility-date', '2026-09-11'], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
  });
  await waitForServer(`${origin}/`, server);
});

after(() => {
  if (!server || server.exitCode !== null) return;
  process.kill(-server.pid, 'SIGTERM');
});

test('Cloudflare Pages serves valid routes and rejects unknown paths', async () => {
  for (const route of routes) {
    const response = await fetch(`${origin}${route}`);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type') || '', /^text\/html\b/, route);
    const html = await response.text();
    const expected = `https://imgzip.i41.cn${route}`;
    assert.ok(html.includes(`rel="canonical" href="${expected}"`), route);
  }

  for (const asset of ['/manifest.json', '/serviceworker.js', '/sitemap.xml', '/robots.txt']) {
    const response = await fetch(`${origin}${asset}`);
    assert.equal(response.status, 200, asset);
  }

  const missing = await fetch(`${origin}/definitely-not-a-real-route-${Date.now()}/`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type') || '', /^text\/html\b/);
  assert.match(await missing.text(), /<meta name="robots" content="noindex, nofollow"/);
});
