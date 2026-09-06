import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  cp(resolve(dependency, 'dist/csp/heic-to.js'), resolve(thirdParty, 'heic-to-1.5.2.csp.js')),
  cp(resolve(dependency, 'LICENSE'), resolve(thirdParty, 'heic-to-1.5.2.LICENSE.txt')),
  cp(resolve(dependency, 'src'), resolve(thirdParty, 'heic-to-1.5.2-source'), { recursive: true }),
  cp(resolve(dependency, 'README.md'), resolve(thirdParty, 'heic-to-1.5.2.README.md')),
  cp(resolve(dependency, 'package.json'), resolve(thirdParty, 'heic-to-1.5.2.package.json')),
]);
