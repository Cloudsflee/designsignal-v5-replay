import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { runDaily } from '../src/app.mjs';
import { startServer } from '../src/server.mjs';
import { fixtureConfig } from '../test/helpers.mjs';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');
const outputDirectory = process.env.DESIGNSIGNAL_BROWSER_OUTPUT_DIR
  ? path.resolve(process.env.DESIGNSIGNAL_BROWSER_OUTPUT_DIR)
  : null;
const viewports = [
  { width: 390, height: 844, name: 'mobile' },
  { width: 1024, height: 768, name: 'tablet' },
  { width: 1440, height: 900, name: 'desktop' }
];
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'designsignal-v6-browser-'));
const fallback = (await runDaily(fixtureConfig(path.join(root, 'fallback')))).report;
const service = await startServer({ ...fixtureConfig(path.join(root, 'server')), host: '127.0.0.1', port: 0 }, { fallbackReport: fallback });
const browser = await chromium.launch({ headless: true });
const receipts = [];
if (outputDirectory) await fs.mkdir(outputDirectory, { recursive: true });
try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    const consoleErrors = [];
    const pageErrors = [];
    const httpErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(String(error.message || error)));
    page.on('response', (response) => {
      if (response.status() >= 400) httpErrors.push(`${response.status()}:${new URL(response.url()).pathname}`);
    });
    await page.addInitScript({ path: axePath });
    await page.goto(service.url, { waitUntil: 'networkidle' });
    const axe = await page.evaluate(async () => {
      const result = await window.axe.run(document, { resultTypes: ['violations'] });
      return result.violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.length }));
    });
    const layout = await page.evaluate(() => {
      const body = document.body;
      const overflow = document.documentElement.scrollWidth > window.innerWidth || body.scrollWidth > window.innerWidth;
      const brokenImages = [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length;
      const cards = [...document.querySelectorAll('.signal-card')]
        .filter((card) => !card.hidden)
        .map((card) => card.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);
      let overlap = false;
      for (let index = 0; index < cards.length; index += 1)
        for (let next = index + 1; next < cards.length; next += 1) {
          const left = cards[index];
          const right = cards[next];
          if (left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top) overlap = true;
        }
      return { overflow, brokenImages, overlap };
    });
    let screenshot = null;
    if (outputDirectory) {
      const screenshotPath = path.join(outputDirectory, `${viewport.name}-${viewport.width}x${viewport.height}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const bytes = await fs.readFile(screenshotPath);
      screenshot = {
        path: publicArtifactPath(screenshotPath),
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')
      };
    }
    receipts.push({
      viewport,
      axeViolations: axe,
      consoleErrors,
      pageErrors,
      httpErrors,
      layout,
      screenshot,
      pass: !axe.length && !consoleErrors.length && !pageErrors.length && !httpErrors.length && !layout.overflow && !layout.brokenImages && !layout.overlap
    });
    await page.close();
  }
} finally {
  await browser.close();
  await service.close();
  await fs.rm(root, { recursive: true, force: true });
}
const result = { schemaVersion: 'designsignal.browser-a11y.v1', viewports: receipts, pass: receipts.every((receipt) => receipt.pass) };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.pass) process.exitCode = 1;

function publicArtifactPath(value) {
  const relative = path.relative(path.resolve('.'), value);
  return relative.startsWith('..') || path.isAbsolute(relative) ? path.basename(value) : relative.replaceAll('\\', '/');
}
