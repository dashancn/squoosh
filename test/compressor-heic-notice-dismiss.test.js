import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('HEIC notice has an accessible close button', async () => {
  const app = await read('src/client/initial-app/App/index.tsx');
  assert.match(app, /aria-label="关闭 HEIC 提示"/);
  assert.match(app, /onClick=\{this\.dismissHeicNotice\}/);
  assert.match(app, /class=\{style\.heicNoticeClose\}/);
});

test('successful HEIC notice dismisses automatically after five seconds', async () => {
  const app = await read('src/client/initial-app/App/index.tsx');
  assert.match(app, /HEIC_NOTICE_AUTO_DISMISS_MS = 5000/);
  assert.match(app, /heicNotice\?\.kind === 'success'/);
  assert.match(
    app,
    /window\.setTimeout\([\s\S]*this\.dismissHeicNotice,[\s\S]*HEIC_NOTICE_AUTO_DISMISS_MS/,
  );
  assert.match(app, /window\.clearTimeout/);
});

test('HEIC close button remains reachable without covering notice content', async () => {
  const css = await read('src/client/initial-app/App/style.css');
  assert.match(css, /\.heic-notice-close/);
  assert.match(css, /position:\s*absolute/);
  assert.match(css, /min-width:\s*32px/);
  assert.match(css, /padding:\s*12px 48px 12px 16px/);
  assert.match(css, /outline:\s*3px solid #3150b4/);
  assert.match(css, /outline-offset:\s*2px/);
});

test('success auto-dismiss pauses during pointer or keyboard interaction', async () => {
  const app = await read('src/client/initial-app/App/index.tsx');
  assert.match(app, /onMouseEnter=\{this\.pauseHeicNoticeDismiss\}/);
  assert.match(app, /onMouseLeave=\{this\.resumeHeicNoticeDismiss\}/);
  assert.match(app, /onFocus=\{this\.pauseHeicNoticeDismiss\}/);
  assert.match(app, /onBlur=\{this\.resumeHeicNoticeDismiss\}/);
  assert.match(app, /this\.state\.heicNotice\?\.kind !== 'success'/);
});
