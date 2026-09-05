import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

const run = promisify(execFile);
const root = new URL('..', import.meta.url);
const built = (path) =>
  readFile(
    new URL(`../build/remove-background/${path}`, import.meta.url),
    'utf8',
  );

before(async () => {
  await run('npm', ['run', 'build:remove-background'], { cwd: root });
});

test('构建后的 AGPL 链接可读取许可证正文', async () => {
  const html = await built('index.html');
  assert.match(html, /href="\.\/LICENSE-AGPL\.md"/);
  const license = await built('LICENSE-AGPL.md');
  assert.match(license, /GNU Affero General Public License/);
});

test('构建后的页面保留本站修改源代码链接', async () => {
  const html = await built('index.html');
  assert.match(
    html,
    /href="https:\/\/github\.com\/dashancn\/squoosh\/tree\/feat\/independent-image-tools"/,
  );
  assert.match(html, /本站修改后的完整源代码/);
});
