import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage();

// Render concept B as app icon (1024x1024)
await page.setViewportSize({ width: 1024, height: 1024 });
await page.goto(`file://${path.join(__dirname, 'icon-concept-b.svg')}`);
await page.screenshot({ path: path.join(__dirname, 'app-icon-1024.png'), type: 'png' });

// Render concept C as favicon PNG (192x192 for PWA)
await page.goto(`file://${path.join(__dirname, 'icon-concept-c.svg')}`);
await page.screenshot({ path: path.join(__dirname, 'favicon-192.png'), type: 'png' });

await browser.close();
console.log('Done');
