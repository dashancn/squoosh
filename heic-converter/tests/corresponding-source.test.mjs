import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const sourceRoot = new URL('../corresponding-source/', import.meta.url);

test('documented low-level rebuild places libde265 archive in build script cwd', async () => {
  const document = await readFile(new URL('CORRESPONDING-SOURCE.md', sourceRoot), 'utf8');
  const shell = document.match(/## Rebuild the embedded libheif \+ libde265 JavaScript[\s\S]*?```sh\n([\s\S]*?)```/)?.[1];
  assert.ok(shell, 'low-level rebuild shell commands missing');

  const directory = await mkdtemp(path.join(tmpdir(), 'heic-offline-contract-'));
  try {
    await writeFile(path.join(directory, 'libde265-1.0.16.tar.gz'), 'shipped archive');
    await writeFile(path.join(directory, 'libheif-v1.22.2.tar.gz'), 'stub archive');
    await writeFile(path.join(directory, 'tar'), '#!/bin/sh\nmkdir -p libheif-1.22.2\nprintf "#!/bin/sh\\ntest -f libde265-1.0.16.tar.gz\\n" > libheif-1.22.2/build-emscripten.sh\nchmod +x libheif-1.22.2/build-emscripten.sh\n');
    execFileSync('chmod', ['+x', path.join(directory, 'tar')]);

    execFileSync('sh', ['-eu', '-c', shell], {
      cwd: directory,
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
      stdio: 'pipe',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
