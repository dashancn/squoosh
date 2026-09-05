import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = dirname(fileURLToPath(import.meta.url));
const destination = resolve(source, '../build/collage');

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await Promise.all([
  cp(resolve(source, 'index.html'), resolve(destination, 'index.html')),
  cp(resolve(source, 'style.css'), resolve(destination, 'style.css')),
  cp(resolve(source, 'src'), resolve(destination, 'src'), { recursive: true }),
]);
