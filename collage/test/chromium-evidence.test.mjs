import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';

test('真实 Chromium 证据覆盖独立页面、多图上传与三种 PNG 模式', async () => {
  const path = new URL('../evidence/chromium.json', import.meta.url);
  await assert.doesNotReject(() => access(path));
  const evidence = JSON.parse(await readFile(path, 'utf8'));
  assert.match(evidence.chromiumVersion, /^\d+\.\d+\.\d+\.\d+$/);
  assert.equal(evidence.path, '/collage/');
  assert.equal(evidence.inputCount, 3);
  assert.equal(evidence.iframeCount, 0);
  assert.deepEqual(evidence.results.map((result) => result.mode), [
    'grid', 'vertical', 'horizontal', 'two-columns', 'two-rows', 'three-feature', 'four-grid',
  ]);
  assert.equal(evidence.focal.centerPercent, 50);
  assert.equal(evidence.focal.topPercent, 10);
  assert.ok(evidence.focal.topSourceY < evidence.focal.centerSourceY);
  assert.equal(evidence.focal.type, 'image/png');
  assert.ok(evidence.focal.size > 0);
  assert.ok(evidence.mobile.editorVisible);
  assert.ok(evidence.mobile.sliderWidth >= 250);
  assert.ok(evidence.mobile.sliderRight <= evidence.mobile.viewportWidth);
  for (const result of evidence.results) {
    assert.equal(result.type, 'image/png');
    assert.ok(result.size > 0);
    assert.ok(result.width > 0 && result.height > 0);
    assert.ok(result.previewVisible);
    assert.ok(result.downloadReady);
    assert.match(result.file, new RegExp(`chromium-${result.mode}\\.png$`));
    const file = new URL(`../${result.file}`, import.meta.url);
    assert.equal((await stat(file)).size, result.size);
  }
  assert.deepEqual(evidence.pageErrors, []);
});
