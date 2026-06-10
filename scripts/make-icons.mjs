// Regenerate the extension icons from logo.png. Run: npm run icons
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

await mkdir('src/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await sharp('logo.png')
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(`src/icons/icon${size}.png`);
  console.log(`wrote src/icons/icon${size}.png`);
}
