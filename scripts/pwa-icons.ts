/** Renders the PWA icons from src/app/icon.svg. Run once after the logo changes: yarn pwa:icons */
import { mkdirSync, readFileSync } from 'node:fs';
import sharp from 'sharp';

async function main() {
  const svg = readFileSync('src/app/icon.svg');
  mkdirSync('public/icons', { recursive: true });

  for (const size of [192, 512]) {
    await sharp(svg, { density: 1200 }).resize(size, size).png().toFile(`public/icons/icon-${size}.png`);
  }

  // Maskable: the logo at 70% on the brand colour, so a circle or squircle mask never cuts it.
  const inner = await sharp(svg, { density: 1200 }).resize(358, 358).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: '#615fff' } })
    .composite([{ input: inner, gravity: 'center' }])
    .png()
    .toFile('public/icons/icon-maskable-512.png');

  // Android status-bar badge: only the alpha channel shows, so just the logo's check, white on transparent.
  const check = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 4 24 24"><path d="M9.5 16.5l4.2 4.2L22.5 11" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  await sharp(Buffer.from(check), { density: 1200 }).resize(72, 72).png().toFile('public/icons/badge-72.png');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
