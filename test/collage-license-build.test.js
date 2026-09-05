import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.resolve(new URL('..', import.meta.url).pathname);
const build = path.join(root, 'build');

before(async () => {
  await run('npm', ['run', 'build:collage'], { cwd: root });
  await run('npm', ['run', 'build:license'], { cwd: root });
});

test('构建产物中的拼图 Apache 链接返回许可证正文和 HTTP 200', async () => {
  const license = await readFile(path.join(build, 'LICENSE'), 'utf8');
  assert.match(license, /Apache License/);

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const target = path.resolve(build, `.${pathname}`);
      assert.ok(target.startsWith(`${build}${path.sep}`));
      response.writeHead(200).end(await readFile(target));
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const htmlResponse = await fetch(`${origin}/collage/`);
    assert.equal(htmlResponse.status, 200);
    const html = await htmlResponse.text();
    const href = html.match(/href="(\.\.\/LICENSE)"/)?.[1];
    assert.equal(href, '../LICENSE');

    const licenseResponse = await fetch(new URL(href, `${origin}/collage/`));
    assert.equal(licenseResponse.status, 200);
    assert.match(await licenseResponse.text(), /Apache License/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
