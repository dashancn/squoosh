import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const source = dirname(fileURLToPath(import.meta.url));
const destination = resolve(source, '../build/heic-converter');
const dependency = resolve(source, 'node_modules/heic-to');
const thirdParty = resolve(destination, 'third-party');
await rm(destination, { recursive: true, force: true });
await mkdir(thirdParty, { recursive: true });
await Promise.all([
  cp(resolve(source, 'index.html'), resolve(destination, 'index.html')),
  cp(resolve(source, 'style.css'), resolve(destination, 'style.css')),
  cp(resolve(source, 'src'), resolve(destination, 'src'), { recursive: true }),
  cp(resolve(dependency, 'LICENSE'), resolve(thirdParty, 'heic-to-1.5.2.LICENSE.txt')),
  cp(resolve(dependency, 'src'), resolve(thirdParty, 'heic-to-1.5.2-source'), { recursive: true }),
  cp(resolve(dependency, 'README.md'), resolve(thirdParty, 'heic-to-1.5.2.README.md')),
  cp(resolve(dependency, 'package.json'), resolve(thirdParty, 'heic-to-1.5.2.package.json')),
  cp(resolve(dependency, 'esbuild.mjs'), resolve(thirdParty, 'heic-to-1.5.2.esbuild.mjs')),
  writeFile(resolve(destination, '_headers'), `/heic-converter/*\n  Content-Security-Policy: default-src 'self'; script-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:; style-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n`),
  writeFile(resolve(thirdParty, 'libheif-1.22.2-SOURCE.txt'), 'Preferred source: https://github.com/strukturag/libheif/tree/v1.22.2\nRelease archive: https://github.com/strukturag/libheif/archive/refs/tags/v1.22.2.tar.gz\nBuild instructions: https://github.com/strukturag/libheif/blob/v1.22.2/README.md\n'),
  writeFile(resolve(thirdParty, 'BUILD-AND-RELINK.md'), `# HEIC runtime build and relinking\n\nDistributed runtime: heic-to 1.5.2, built from its npm package sources with libheif 1.22.2 embedded by upstream.\n\nPinned sources:\n- https://github.com/hoppergee/heic-to/tree/v1.5.2\n- https://github.com/strukturag/libheif/tree/v1.22.2\n\nMaterials included here: heic-to src/, README.md, package.json, esbuild.mjs, LICENSE, and the generated heic-to-1.5.2.worker.js. Upstream libheif source and build references are in libheif-1.22.2-SOURCE.txt.\n\nRebuild from the repository root:\n\n1. npm --prefix heic-converter ci\n2. npm --prefix heic-converter run build\n\nThe build bundles heic-converter/vendor/heic-to-worker-entry.mjs with esbuild 0.25.4. To relink a modified LGPL library, replace the pinned heic-to/libheif source used by that entry, rebuild, and replace third-party/heic-to-1.5.2.worker.js. Application scripts communicate with that separable module worker and do not incorporate it into the Apache-2.0 application code.\n`),
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

const rootHeadersPath = resolve(destination, '../_headers');
const routeHeaders = `/heic-converter/*\n  Content-Security-Policy: default-src 'self'; script-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:; style-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n`;
let rootHeaders = '';
try { rootHeaders = await readFile(rootHeadersPath, 'utf8'); } catch {}
const marker = '/heic-converter/*';
const beforeRoute = rootHeaders.includes(marker) ? rootHeaders.slice(0, rootHeaders.indexOf(marker)).trimEnd() : rootHeaders.trimEnd();
await writeFile(rootHeadersPath, `${beforeRoute}\n\n${routeHeaders}`);
