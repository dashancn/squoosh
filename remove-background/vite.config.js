import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  build: {
    outDir: path.resolve(here, '../build/remove-background'),
    emptyOutDir: true,
  },
});
