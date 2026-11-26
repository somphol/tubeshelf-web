import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:8770/?test=1";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" && !/404|Failed to load resource/.test(message.text())) {
      errors.push(message.text());
    }
  });

  await page.setViewport({ width: 1240, height: 800 });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await page.click("#demo");
  await wait(700);

  await page.click("#search");
  await page.keyboard.type("s");
  await wait(120);
  assert.equal(await page.$eval("#search", (node) => node.value), "s");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "search");
  await page.keyboard.type("o");
  await wait(120);
  assert.equal(await page.$eval("#search", (node) => node.value), "so", "the second character lands");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "search");

  await page.click("#sidebar-search");
  await page.keyboard.type("m");
  await wait(120);
  assert.equal(await page.$eval("#sidebar-search", (node) => node.value), "m");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "sidebar-search");
  await page.keyboard.type("a");
  await wait(120);
  assert.equal(await page.$eval("#sidebar-search", (node) => node.value), "ma", "sidebar keeps typing");

  assert.deepEqual(errors, [], "no page errors");
  console.log(JSON.stringify({ search: "so", sidebar: "ma", errors }, null, 2));
} finally {
  await browser.close();
}
