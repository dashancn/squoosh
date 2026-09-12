const { copyFile, mkdir } = require('fs').promises;
const path = require('path');

const root = path.resolve(__dirname, '..');
const build = path.join(root, 'build');

async function main() {
  await mkdir(build, { recursive: true });
  await Promise.all([
    copyFile(path.join(root, 'LICENSE'), path.join(build, 'LICENSE')),
    copyFile(
      path.join(root, 'icon-large-maskable.png'),
      path.join(build, 'icon-large-maskable.png'),
    ),
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
