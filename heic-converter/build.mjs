import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const source = dirname(fileURLToPath(import.meta.url));
const destination = resolve(source, '../build/heic-converter');
const dependency = resolve(source, 'node_modules/heic-to');
const correspondingSource = resolve(source, 'corresponding-source');
const thirdParty = resolve(destination, 'third-party');
await rm(destination, { recursive: true, force: true });
await mkdir(thirdParty, { recursive: true });
await Promise.all([
  cp(resolve(source, 'index.html'), resolve(destination, 'index.html')),
  cp(resolve(source, 'style.css'), resolve(destination, 'style.css')),
  cp(resolve(source, 'src'), resolve(destination, 'src'), { recursive: true }),
  cp(correspondingSource, thirdParty, { recursive: true }),
  cp(resolve(dependency, 'LICENSE'), resolve(thirdParty, 'heic-to-1.5.2.LICENSE.txt')),
  cp(resolve(dependency, 'src'), resolve(thirdParty, 'heic-to-1.5.2-source'), { recursive: true }),
  cp(resolve(dependency, 'README.md'), resolve(thirdParty, 'heic-to-1.5.2.README.md')),
  cp(resolve(dependency, 'package.json'), resolve(thirdParty, 'heic-to-1.5.2.package.json')),
  cp(resolve(dependency, 'esbuild.mjs'), resolve(thirdParty, 'heic-to-1.5.2.esbuild.mjs')),
  cp(resolve(correspondingSource, 'CORRESPONDING-SOURCE.md'), resolve(thirdParty, 'BUILD-AND-RELINK.md')),
]);
await build({
  entryPoints: [resolve(source, 'vendor/heic-to-worker-entry.mjs')],
  outfile: resolve(thirdParty, 'heic-to-1.5.2.worker.js'),
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  external: ['fs', 'path', 'crypto'],
});
