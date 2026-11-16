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
  await wait(500);

  const section = (title) => page.evaluate((name) => {
    const head = [...document.querySelectorAll(".side-head")].find((node) => node.textContent.includes(name));
    return head ? {
      expanded: head.getAttribute("aria-expanded"),
      listHidden: head.nextElementSibling.hidden,
    } : null;
  }, title);
  const sidebarHidden = () => page.$eval("#main", (node) => node.classList.contains("sidebar-hidden"));
  const toggleText = () => page.$eval("#sidebar-toggle", (node) => node.textContent);
  const pinText = () => page.$eval("#sidebar-pin", (node) => node.textContent);

  assert.equal(await page.$$eval(".side-head", (nodes) => nodes.length), 4, "four sections");
  assert.equal((await section("Categories")).expanded, "true");

  await page.evaluate(() => {
    [...document.querySelectorAll(".side-head")].find((node) => node.textContent.includes("Categories")).click();
  });
  await wait(150);
  assert.equal((await section("Categories")).expanded, "false", "section folds");
  assert.equal((await section("Categories")).listHidden, true);
  await page.evaluate(() => {
    [...document.querySelectorAll(".side-head")].find((node) => node.textContent.includes("Categories")).click();
  });
  await wait(150);
  assert.equal((await section("Categories")).expanded, "true", "section opens");

  const contentWidth = () => page.$eval("#content", (node) => node.getBoundingClientRect().width);
  const withSidebar = await contentWidth();
  await page.click("#sidebar-toggle");
  await wait(150);
  assert.equal(await sidebarHidden(), true, "sidebar hides");
  assert.equal(await toggleText(), "»");
  assert.ok((await contentWidth()) > withSidebar + 150, "content fills the freed width");
  await page.click("#sidebar-toggle");
  await wait(150);
  assert.equal(await sidebarHidden(), false, "sidebar shows");
  assert.ok((await contentWidth()) < withSidebar + 50, "content returns beside the sidebar");

  assert.equal(await pinText(), "Pinned");
  await page.click("#sidebar-pin");
  await wait(150);
  assert.equal(await pinText(), "Pin", "sidebar unpins");
  await page.mouse.move(600, 400);
  await wait(900);
  assert.equal(await sidebarHidden(), true, "unpinned sidebar auto-hides");
  assert.equal(await page.$eval("#sidebar-peek", (node) => node.hidden), false, "left edge can reveal it");
  await page.mouse.move(3, 400);
  await wait(300);
  assert.equal(await sidebarHidden(), false, "left edge reveals the sidebar");

  await page.click("#sidebar-pin");
  await wait(150);
  assert.equal(await pinText(), "Pinned");
  await page.mouse.move(600, 400);
  await wait(900);
  assert.equal(await sidebarHidden(), false, "pinned sidebar stays");

  await page.evaluate(() => {
    [...document.querySelectorAll(".side-head")].find((node) => node.textContent.includes("Pinned")).click();
  });
  await wait(1500);
  await page.reload({ waitUntil: "networkidle2" });
  await wait(800);
  assert.equal((await section("Pinned")).expanded, "false", "fold survives reload");
  assert.equal(await pinText(), "Pinned", "pin survives reload");

  await page.setViewport({ width: 390, height: 844 });
  await wait(200);
  assert.deepEqual(
    await page.$$eval(".side-head", (nodes) => nodes.map((node) => getComputedStyle(node).display)),
    ["none", "none", "none", "none"],
    "section headers hide on mobile"
  );
  assert.deepEqual(
    await page.$$eval(".side-list", (nodes) => nodes.map((node) => getComputedStyle(node).display)),
    ["flex", "flex", "flex", "flex"],
    "folded rows show on mobile"
  );
  await page.click("#sidebar-toggle");
  await wait(150);
  assert.equal(await sidebarHidden(), true, "mobile toggle hides the strip");

  assert.deepEqual(errors, [], "no page errors");
  console.log(JSON.stringify({ sections: 4, autoHide: true, pin: true, errors }, null, 2));
} finally {
  await browser.close();
}
