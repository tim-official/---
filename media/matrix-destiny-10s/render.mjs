import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(root, "..", "..");
const work = path.join(repository, ".tools", "matrix-video-work");
const mode = process.argv[2];
assert(["stills", "frames"].includes(mode), "Usage: node render.mjs stills|frames");
assert(process.env.APPDATA, "This renderer uses the existing Windows Playwright installation");
const require = createRequire(path.join(process.env.APPDATA, "npm", "node_modules", "@playwright", "test", "package.json"));
const { chromium } = require("playwright");
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 1,
    offline: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) errors.push(message.text());
  });
  page.on("request", (request) => {
    if (!request.url().startsWith("file:") && !request.url().startsWith("data:")) requests.push(request.url());
  });
  const url = pathToFileURL(path.join(root, "scene.html"));
  url.searchParams.set("render", "");
  await page.goto(url.href);
  await page.evaluate(() => document.fonts.ready);
  assert.deepEqual(errors, [], "Scene loading failed");
  assert.equal(await page.locator("canvas").count(), 1);
  assert.equal(await page.evaluate(() => typeof window.renderFrame), "function");
  const destination = path.join(work, mode);
  await mkdir(destination, { recursive: true });
  const frames = mode === "stills" ? [48, 150, 285, 450, 558] : Array.from({ length: 600 }, (_, i) => i);
  for (const frame of frames) {
    const result = await page.evaluate((index) => window.renderFrame(index), frame);
    assert.equal(result.width, 1080);
    assert.equal(result.height, 1920);
    for (const bounds of result.textBounds) {
      assert(bounds.x >= 80 && bounds.x + bounds.width <= 1000, `Unsafe horizontal text: ${bounds.text}`);
      assert(bounds.y >= 100 && bounds.y + bounds.height <= 1820, `Unsafe vertical text: ${bounds.text}`);
    }
    await page.screenshot({
      path: path.join(destination, `${String(frame).padStart(5, "0")}.${mode === "stills" ? "png" : "jpg"}`),
      type: mode === "stills" ? "png" : "jpeg",
      ...(mode === "frames" ? { quality: 97 } : {}),
      animations: "disabled",
      caret: "hide",
    });
    assert.deepEqual(errors, [], "Browser errors must be fixed before rendering");
    assert.deepEqual(requests, [], "The animation must render without external requests");
    if (mode === "stills" || frame % 60 === 0) console.log(`Rendered frame ${frame} / 599`);
  }
  const frame = 450;
  await page.evaluate((index) => window.renderFrame(index), frame);
  const first = await page.screenshot();
  await page.evaluate(() => window.renderFrame(10));
  await page.evaluate((index) => window.renderFrame(index), frame);
  const second = await page.screenshot();
  assert(first.equals(second), "Rendering must be deterministic and independent of earlier frames");
  console.log(`Completed ${frames.length} frames; safe zones, offline rendering and determinism passed.`);
} finally {
  await browser.close();
}
