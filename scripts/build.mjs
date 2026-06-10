import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: { main: 'src/main/index.js', ui: 'src/ui/index.js' },
  bundle: true,
  format: 'iife',
  target: 'chrome111',
  outdir: 'dist',
});
await copyFile('src/manifest.json', 'dist/manifest.json');
await copyFile('src/ui/button.css', 'dist/button.css');
console.log('Built extension to dist/');
