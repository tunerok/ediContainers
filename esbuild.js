const esbuild = loadEsbuild();
const watch = process.argv.includes('--watch');

function loadEsbuild() {
  try {
    return require('esbuild');
  } catch {
    const cursorEsbuild =
      '/Applications/Cursor.app/Contents/Resources/app/extensions/node_modules/esbuild-wasm';
    return require(cursorEsbuild);
  }
}

async function main() {
  const context = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'out/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    sourcemap: true,
    target: 'node18',
  });

  if (watch) {
    await context.watch();
    console.log('Watching for changes...');
    return;
  }

  await context.rebuild();
  await context.dispose();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
