import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:8770/";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
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
await new Promise((resolve) => setTimeout(resolve, 700));

const buttons = await page.$$(".content-head .button");
for (const button of buttons) {
  if ((await button.evaluate((node) => node.textContent)) === "3D") {
    await button.click();
    break;
  }
}
await page.waitForSelector("#graph-container canvas", { timeout: 15000 });
await new Promise((resolve) => setTimeout(resolve, 3000));

const labels = await page.$$eval(".graph-label", (nodes) =>
  nodes.filter((node) => node.style.display !== "none").map((node) => node.textContent)
);
assert.ok(labels.length >= 1, "at least one Hub label is visible");

const hub = await page.$(".graph-label");
const hubName = await hub.evaluate((node) => node.textContent);
await hub.click();
await new Promise((resolve) => setTimeout(resolve, 300));
const info = await page.$eval(".graph-info", (node) => node.textContent);
assert.ok(info.includes(hubName), `info card names ${hubName}`);

const show = await page.$(".graph-info .button");
await show.click();
await new Promise((resolve) => setTimeout(resolve, 300));
const title = await page.$eval(".content-head h2", (node) => node.textContent);
assert.equal(title, hubName);
assert.deepEqual(errors, [], "no page errors");
assert.equal(await page.$eval("#graph-container", () => true).catch(() => false), false, "graph destroyed on Grid");

console.log(JSON.stringify({ labels, hubName, title, errors }, null, 2));
await browser.close();
