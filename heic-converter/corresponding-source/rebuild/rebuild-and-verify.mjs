import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { build } from 'esbuild';
import { findChromiumExecutable } from './chromium-executable.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(here, '..');
const out = resolve(here, 'out');
const extracted = resolve(out, 'source');
const stagedEntry = resolve(out, 'vendor/heic-to-worker-entry.mjs');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const sums = Object.fromEntries((await readFile(resolve(sourceRoot, 'SHA256SUMS'), 'utf8')).trim().split('\n').map((line) => {
  const [hash, name] = line.trim().split(/\s+/);
  return [name, hash];
}));
for (const [name, expected] of Object.entries(sums)) {
  assert.equal(sha256(await readFile(resolve(sourceRoot, name))), expected, `${name} checksum mismatch`);
}

await rm(out, { recursive: true, force: true });
await mkdir(extracted, { recursive: true });
execFileSync('tar', ['-xzf', resolve(sourceRoot, 'heic-to-v1.5.2.tar.gz'), '-C', extracted]);
const packageSource = resolve(extracted, 'heic-to-1.5.2');
await mkdir(resolve(out, 'node_modules'), { recursive: true });
await mkdir(resolve(out, 'vendor'), { recursive: true });
await cp(resolve(here, 'heic-to-worker-entry.mjs'), stagedEntry);
await cp(packageSource, resolve(out, 'node_modules/heic-to'), { recursive: true });

const output = resolve(out, 'heic-to-1.5.2.worker.js');
await build({
  entryPoints: [stagedEntry],
  outfile: output,
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  external: ['fs', 'path', 'crypto'],
});

const generatedHash = sha256(await readFile(output));
const expectedHash = (await readFile(resolve(here, 'expected-worker.sha256'), 'utf8')).trim();
assert.equal(generatedHash, expectedHash, 'worker bytes differ; inspect toolchain before replacing the distributed worker');

const fixture = await readFile(resolve(here, 'fixture.heic'));
const browser = await chromium.launch({ executablePath: findChromiumExecutable(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
let verification;
try {
  const page = await browser.newPage();
  verification = await page.evaluate(async ({ source, bytes }) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try {
      const worker = await import(url);
      const buffer = new Uint8Array(bytes).buffer;
      const inspected = worker.inspectHeic(buffer);
      const decoded = await worker.decodeHeic(buffer, (width, height) => {
        if (width !== inspected.width || height !== inspected.height) throw new Error('dimension callback mismatch');
      });
      return {
        exports: Object.keys(worker).sort(),
        isHeic: worker.isHeicBytes(buffer),
        dimensions: inspected,
        decoded: { width: decoded.width, height: decoded.height },
      };
    } finally { URL.revokeObjectURL(url); }
  }, { source: await readFile(output, 'utf8'), bytes: [...fixture] });
} finally { await browser.close(); }
assert.deepEqual(verification.exports, ['decodeHeic', 'inspectHeic', 'isHeicBytes']);
assert.equal(verification.isHeic, true);
assert.ok(verification.dimensions.width > 0 && verification.dimensions.height > 0);
assert.deepEqual(verification.decoded, verification.dimensions);
console.log(JSON.stringify({ workerSha256: generatedHash, ...verification }));
