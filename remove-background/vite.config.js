import { defineConfig } from 'vite';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../build/remove-background');

function copyAgplLicense() {
  return {
    name: 'copy-agpl-license',
    async writeBundle() {
      await copyFile(
        path.resolve(here, 'LICENSE-AGPL.md'),
        path.join(outDir, 'LICENSE-AGPL.md'),
      );
    },
  };
}

export default defineConfig({
  plugins: [copyAgplLicense()],
  base: './',
  build: {
    outDir,
    emptyOutDir: true,
  },
});
