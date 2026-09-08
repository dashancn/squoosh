import { defineConfig } from 'vite';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../build/remove-background');
const sourceCommit =
  process.env.CF_PAGES_COMMIT_SHA ||
  execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: here,
    encoding: 'utf8',
  }).trim();

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

function stampSourceCommit() {
  return {
    name: 'stamp-source-commit',
    transformIndexHtml(html) {
      return html.replaceAll('__SOURCE_COMMIT__', sourceCommit);
    },
  };
}

export default defineConfig({
  plugins: [stampSourceCommit(), copyAgplLicense()],
  base: './',
  build: {
    outDir,
    emptyOutDir: true,
  },
});
